package provider

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
)

var (
	ErrNotFound = errors.New("no such provider")
	ErrExists   = errors.New("provider id taken")
	// ErrBound: External Identities still use the Provider.
	ErrBound = errors.New("provider has bindings")
	// ErrLogin: the callback matches no login in flight here, or the
	// Provider turned it down.
	ErrLogin = errors.New("provider login failed")
)

// Store keeps the Providers an admin added, and their External Identities,
// in PG.
type Store struct {
	pool    *pgxpool.Pool
	q       *sqlc.Queries
	keyring *crypt.Keyring
}

func NewStore(pool *pgxpool.Pool, keyring *crypt.Keyring) *Store {
	return &Store{pool: pool, q: sqlc.New(pool), keyring: keyring}
}

// Settings are a Provider as an admin may read them: secret fields show only
// when they were last set.
type Settings struct {
	ID        string               `json:"id"`
	Type      string               `json:"type"`
	Name      string               `json:"name"`
	Enabled   bool                 `json:"enabled"`
	Config    map[string]string    `json:"config" doc:"Fields that are not secret"`
	Secrets   map[string]time.Time `json:"secrets" doc:"When each secret field was last set"`
	CreatedAt time.Time            `json:"createdAt" doc:"The login page lists Providers in this order"`
	Bound     int64                `json:"bound" doc:"Users with an External Identity of it"`
	// The Users who could no longer sign in were it disabled.
	OnlyLoginPath int64 `json:"onlyLoginPath" doc:"Bound Users with no other way to sign in"`
}

// List returns every Provider, oldest first.
func (s *Store) List(ctx context.Context) ([]Settings, error) {
	rows, err := s.q.ListProviders(ctx)
	if err != nil {
		return nil, err
	}
	out := []Settings{}
	for _, r := range rows {
		p := Settings{ID: r.ID, Type: r.Type, Name: r.Name, Enabled: r.Enabled, CreatedAt: r.CreatedAt.Time,
			Bound: r.Bound, OnlyLoginPath: r.OnlyLoginPath}
		if err := json.Unmarshal(r.Config, &p.Config); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(r.Secrets, &p.Secrets); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

var idRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// Create adds an enabled Provider of type typ.
func (s *Store) Create(ctx context.Context, id, typ, name string, config map[string]string) error {
	t := GetType(typ)
	if t == nil {
		return identity.Invalid("没有这个 Provider 类型:" + typ)
	}
	if !idRE.MatchString(id) {
		return identity.Invalid("Provider ID 须为 1–32 位小写字母、数字或 -,以字母或数字开头")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		plain, fresh, err := s.check(ctx, q, t, id, name, config, nil)
		if err != nil {
			return err
		}
		err = q.InsertProvider(ctx, sqlc.InsertProviderParams{ID: id, Type: typ, Name: strings.TrimSpace(name), Config: plain})
		if isCode(err, "23505") {
			return ErrExists
		} else if err != nil {
			return err
		}
		return s.putSecrets(ctx, q, id, fresh)
	})
}

// Update changes a Provider's name and settings. An empty secret field keeps
// the stored value; an Immutable field must stay as it is.
func (s *Store) Update(ctx context.Context, id, name string, config map[string]string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		r, err := q.GetProviderForUpdate(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		t := GetType(r.Type)
		if t == nil {
			return fmt.Errorf("provider type %q is not in this build", r.Type)
		}
		var old map[string]string
		if err := json.Unmarshal(r.Config, &old); err != nil {
			return err
		}
		plain, fresh, err := s.check(ctx, q, t, id, name, config, old)
		if err != nil {
			return err
		}
		if err := q.UpdateProvider(ctx, sqlc.UpdateProviderParams{ID: id, Name: strings.TrimSpace(name), Config: plain}); err != nil {
			return err
		}
		return s.putSecrets(ctx, q, id, fresh)
	})
}

// check validates name and config against t, returning the plain settings
// as JSON and the secret fields to (re)seal. old is the stored plain config
// of an existing Provider, nil for a new one.
func (s *Store) check(ctx context.Context, q *sqlc.Queries, t *Type, id, name string, config, old map[string]string) ([]byte, map[string]string, error) {
	if name = strings.TrimSpace(name); name == "" || utf8.RuneCountInString(name) > 64 {
		return nil, nil, identity.Invalid("名称须为 1–64 个字")
	}
	stored := map[string]string{}
	if old != nil {
		var err error
		if stored, err = s.secrets(ctx, q, id); err != nil {
			return nil, nil, err
		}
	}
	plain, full, fresh := map[string]string{}, map[string]string{}, map[string]string{}
	for _, f := range t.Fields {
		v := strings.TrimSpace(config[f.Key])
		switch {
		case f.Secret && v != "":
			fresh[f.Key] = v
		case f.Secret:
			v = stored[f.Key]
		default:
			plain[f.Key] = v
		}
		if old != nil && f.Immutable && v != old[f.Key] {
			return nil, nil, identity.Invalid(f.Label + " 添加后不能修改")
		}
		if v == "" {
			if !f.Optional {
				return nil, nil, identity.Invalid(f.Label + " 必填")
			}
			continue
		}
		if err := f.Check(v); err != nil {
			return nil, nil, err
		}
		full[f.Key] = v
	}
	if _, err := t.New(full); err != nil {
		return nil, nil, identity.Invalid(err.Error())
	}
	js, err := json.Marshal(plain)
	return js, fresh, err
}

func (s *Store) putSecrets(ctx context.Context, q *sqlc.Queries, id string, fresh map[string]string) error {
	for k, v := range fresh {
		sealed, err := s.keyring.Seal([]byte(v), secretAAD(id, k))
		if err != nil {
			return err
		}
		if err := q.PutProviderSecret(ctx, sqlc.PutProviderSecretParams{Provider: id, Field: k, Value: sealed}); err != nil {
			return err
		}
	}
	return nil
}

// SetEnabled turns a Provider on or off. A disabled one leaves the login
// page, and its External Identities sign nobody in.
func (s *Store) SetEnabled(ctx context.Context, id string, enabled bool) error {
	n, err := s.q.SetProviderEnabled(ctx, sqlc.SetProviderEnabledParams{ID: id, Enabled: enabled})
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

// Delete removes a Provider no External Identity uses.
func (s *Store) Delete(ctx context.Context, id string) error {
	n, err := s.q.DeleteProvider(ctx, id)
	if isCode(err, "23503") {
		return ErrBound
	} else if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

// Button is an enabled Provider on the login page.
type Button struct{ ID, Name string }

// Buttons lists the enabled Providers, oldest first.
func (s *Store) Buttons(ctx context.Context) ([]Button, error) {
	rows, err := s.q.EnabledProviders(ctx)
	var out []Button
	for _, r := range rows {
		out = append(out, Button{ID: r.ID, Name: r.Name})
	}
	return out, err
}

// Begin starts signing in at the enabled Provider id for the OIDC
// authorization authnSession, and returns where to send the browser.
func (s *Store) Begin(ctx context.Context, issuer, id, authnSession string) (string, error) {
	return s.begin(ctx, issuer, id, func(stateHash []byte, nonce, verifier string) error {
		return s.q.InsertProviderLogin(ctx, sqlc.InsertProviderLoginParams{
			StateHash: stateHash, Provider: id, Nonce: nonce, Verifier: verifier, AuthnSession: authnSession,
		})
	})
}

// begin keeps a new redirect to the enabled Provider id with save and
// returns where to send the browser.
func (s *Store) begin(ctx context.Context, issuer, id string, save func(stateHash []byte, nonce, verifier string) error) (string, error) {
	p, err := s.provider(ctx, id)
	if err != nil {
		return "", err
	}
	state, nonce, verifier := rand.Text()+rand.Text(), rand.Text(), rand.Text()+rand.Text()
	if err := save(hash(state), nonce, verifier); err != nil {
		return "", err
	}
	return p.AuthURL(ctx, CallbackURL(issuer, id), state, nonce, verifier)
}

// Finished is how a Provider's callback went.
type Finished struct {
	// AuthnSession is the OIDC authorization a login was for, and Sub the
	// User signed in.
	AuthnSession, Sub string
	// Account is set for a redirect from the account center: "bound" or
	// "reauthenticated", even when it failed.
	Account string
}

// Finish takes the Provider's callback parameters for a redirect Begin or
// BeginAccount started. A login finds its OIDC authorization and the User
// signed in: the one bound to the External Identity, or a new User (logging
// in is signing up). Each redirect finishes once.
func (s *Store) Finish(ctx context.Context, issuer, id string, params url.Values) (Finished, error) {
	var f Finished
	login, err := s.q.TakeProviderLogin(ctx, sqlc.TakeProviderLoginParams{StateHash: hash(params.Get("state")), Provider: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return f, ErrLogin
	} else if err != nil {
		return f, err
	}
	if login.SessionID.Valid {
		f.Account = map[bool]string{false: "bound", true: "reauthenticated"}[login.Reauth]
	}
	p, err := s.provider(ctx, id)
	if err != nil {
		return f, err
	}
	ident, err := p.Callback(ctx, params, CallbackURL(issuer, id), login.Nonce, login.Verifier)
	if err != nil {
		return f, fmt.Errorf("%w: %w", ErrLogin, err)
	}
	if f.Account != "" {
		return f, s.finishAccount(ctx, id, login, ident)
	}
	f.AuthnSession = login.AuthnSession
	f.Sub, err = s.signIn(ctx, id, ident)
	return f, err
}

func (s *Store) signIn(ctx context.Context, id string, ident Identity) (string, error) {
	u, err := s.q.UserByExternalIdentity(ctx, sqlc.UserByExternalIdentityParams{Provider: id, Subject: ident.Subject})
	if err == nil && u.Disabled {
		return "", identity.ErrDisabled
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return u.UserID, err
	}
	var token []byte
	if ident.Token != "" {
		if token, err = s.keyring.Seal([]byte(ident.Token), tokenAAD(id, ident.Subject)); err != nil {
			return "", err
		}
	}
	sub := rand.Text()
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.CreateUser(ctx, sub); err != nil {
			return err
		}
		return q.AddExternalIdentity(ctx, sqlc.AddExternalIdentityParams{Provider: id, Subject: ident.Subject, UserID: sub, Token: token})
	})
	if isCode(err, "23505") { // signed up a moment ago by a concurrent request
		return s.signIn(ctx, id, ident)
	}
	return sub, err
}

// provider builds the enabled Provider id.
func (s *Store) provider(ctx context.Context, id string) (Redirect, error) { return s.build(ctx, id, true) }

// build builds the Provider id; only an enabled one if enabledOnly.
func (s *Store) build(ctx context.Context, id string, enabledOnly bool) (Redirect, error) {
	r, err := s.q.GetProvider(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && enabledOnly && !r.Enabled {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	t := GetType(r.Type)
	if t == nil {
		return nil, fmt.Errorf("provider type %q is not in this build", r.Type)
	}
	config, err := s.secrets(ctx, s.q, id)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(r.Config, &config); err != nil {
		return nil, err
	}
	return t.New(config)
}

// secrets opens a Provider's stored secret fields.
func (s *Store) secrets(ctx context.Context, q *sqlc.Queries, id string) (map[string]string, error) {
	rows, err := q.ProviderSecrets(ctx, id)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, r := range rows {
		v, err := s.keyring.Open(r.Value, secretAAD(id, r.Field))
		if err != nil {
			return nil, err
		}
		out[r.Field] = string(v)
	}
	return out, nil
}

func secretAAD(id, field string) []byte { return []byte("provider:" + id + ":" + field) }

func tokenAAD(id, subject string) []byte {
	return []byte("external_identity:" + id + ":" + subject)
}

func hash(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}

func isCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
