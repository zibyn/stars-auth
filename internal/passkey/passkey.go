// Package passkey keeps a User's Passkeys (GLOSSARY.md): their WebAuthn
// credentials, added and managed from the account center. go-webauthn
// verifies the ceremonies; storage, flow and names live here.
package passkey

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
)

const (
	ErrNotBegun   identity.Invalid = "没有正在进行的添加,请重新开始"
	ErrExpired    identity.Invalid = "验证已过期,请重新添加"
	ErrDuplicate  identity.Invalid = "这把 Passkey 已经添加过了"
	ErrNoUV       identity.Invalid = "设备未验证用户身份,不能添加为 Passkey"
	ErrVerifyFail identity.Invalid = "Passkey 注册未通过验证,请重试"
	ErrName       identity.Invalid = "名称须为 1–64 个字符"

	ErrNoPasskey identity.Invalid = "没有找到这把 Passkey,请改用其他方式登录"
	ErrLoginFail identity.Invalid = "Passkey 登录未通过验证,请重试"
	// ErrCloned is a counter that went backwards: the Passkey may be a
	// clone's. Audited before it is returned.
	ErrCloned identity.Invalid = "这把 Passkey 的计数器异常,已拒绝登录"
)

// ErrGone is a Passkey of the User's that is not; the Account API answers
// 404 for it.
var ErrGone = errors.New("no such passkey")

// challengeTTL is how long a registration may take.
const challengeTTL = 5 * time.Minute

// Store is the Passkey module: the account center (and, later, login and
// the Management API) go through these operations.
type Store struct {
	q      *sqlc.Queries
	issuer string
	wa     *webauthn.WebAuthn
}

// New points the store at an issuer: its origin is the only origin a
// ceremony may happen at, its hostname the RP ID. The origins of the
// instance's registered Android apps are added per ceremony by authn.
func New(pool *pgxpool.Pool, issuer string) (*Store, error) {
	u, err := url.Parse(issuer)
	if err != nil {
		return nil, err
	}
	wa, err := webauthn.New(&webauthn.Config{
		RPID:                  u.Hostname(),
		RPDisplayName:         "Stars Auth",
		RPOrigins:             []string{issuer},
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		},
		Timeouts: webauthn.TimeoutsConfig{
			Registration: webauthn.TimeoutConfig{Timeout: challengeTTL, Enforce: true},
			Login:        webauthn.TimeoutConfig{Timeout: challengeTTL},
		},
	})
	if err != nil {
		return nil, err
	}
	return &Store{q: sqlc.New(pool), issuer: issuer, wa: wa}, nil
}

// user is a User as go-webauthn sees one: their handle is their sub.
type user struct{ sub, name string }

func (u user) WebAuthnID() []byte                         { return []byte(u.sub) }
func (u user) WebAuthnName() string                       { return u.name }
func (u user) WebAuthnDisplayName() string                { return u.name }
func (u user) WebAuthnCredentials() []webauthn.Credential { return nil }

// Passkey is one of a User's Passkeys as the Account and Management APIs
// show it.
type Passkey struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty" doc:"Null until the Passkey has signed in once"`
}

// List is the User's Passkeys, oldest first.
func (s *Store) List(ctx context.Context, sub string) ([]Passkey, error) {
	rows, err := s.q.UserPasskeys(ctx, sub)
	if err != nil {
		return nil, err
	}
	out := make([]Passkey, 0, len(rows))
	for _, r := range rows {
		p := Passkey{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt.Time}
		if r.LastUsedAt.Valid {
			p.LastUsedAt = &r.LastUsedAt.Time
		}
		out = append(out, p)
	}
	return out, nil
}

// Begin starts adding a Passkey to sub's account, in the Session session:
// the creation options to hand to the browser or App, whose challenge is
// kept for Finish. name is how the User is shown in the ceremony, already
// masked.
func (s *Store) Begin(ctx context.Context, sub, name, session string) (json.RawMessage, error) {
	rows, err := s.q.PasskeyExclusions(ctx, sub)
	if err != nil {
		return nil, err
	}
	exclude := make([]protocol.CredentialDescriptor, len(rows))
	for i, r := range rows {
		ts := make([]protocol.AuthenticatorTransport, len(r.Transports))
		for j, t := range r.Transports {
			ts[j] = protocol.AuthenticatorTransport(t)
		}
		exclude[i] = protocol.CredentialDescriptor{CredentialID: r.CredentialID, Transport: ts}
	}
	creation, sd, err := s.wa.BeginRegistration(user{sub, name}, webauthn.WithExclusions(exclude))
	if err != nil {
		return nil, err
	}
	err = s.q.PutPasskeyChallenge(ctx, sqlc.PutPasskeyChallengeParams{
		SessionID: session, UserID: sub, Challenge: sd.Challenge,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(challengeTTL), Valid: true},
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(creation)
}

// RegistrationResponse is the RegistrationResponseJSON the browser or App
// posts back from navigator.credentials.create.
type RegistrationResponse struct {
	ID       string `json:"id" doc:"The credential ID, base64url"`
	RawID    string `json:"rawId" doc:"The credential ID again, base64url"`
	Type     string `json:"type" enum:"public-key"`
	Response struct {
		ClientDataJSON    string   `json:"clientDataJSON" doc:"base64url"`
		AttestationObject string   `json:"attestationObject" doc:"base64url"`
		Transports        []string `json:"transports,omitempty"`
	} `json:"response"`
}

// Finish checks a registration response against the challenge Begin kept
// for the Session and saves the Passkey, named after its authenticator.
func (s *Store) Finish(ctx context.Context, sub, session string, response []byte) (Passkey, error) {
	ch, err := s.q.TakePasskeyChallenge(ctx, session)
	if errors.Is(err, pgx.ErrNoRows) {
		return Passkey{}, ErrNotBegun
	} else if err != nil {
		return Passkey{}, err
	}
	if ch.UserID != sub {
		return Passkey{}, ErrNotBegun
	}
	if !ch.Live {
		return Passkey{}, ErrExpired
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return Passkey{}, ErrVerifyFail
	}
	// A Passkey is a Passkey because it verified the User every time; the
	// rest of the ceremony is go-webauthn's to check.
	if !parsed.Response.AttestationObject.AuthData.Flags.HasUserVerified() {
		return Passkey{}, ErrNoUV
	}
	sd := webauthn.SessionData{
		Challenge: ch.Challenge, UserID: []byte(sub), RelyingPartyID: s.rpID(),
		UserVerification: protocol.VerificationRequired, CredParams: webauthn.CredentialParametersDefault(),
	}
	cred, err := s.wa.CreateCredential(user{sub, sub}, sd, parsed)
	if err != nil {
		return Passkey{}, ErrVerifyFail
	}
	row, err := s.q.AddPasskey(ctx, sqlc.AddPasskeyParams{
		UserID: sub, CredentialID: cred.ID, PublicKey: cred.PublicKey,
		SignCount: int64(cred.Authenticator.SignCount), Aaguid: uuidToPG(cred.Authenticator.AAGUID),
		BackupEligible: cred.Flags.BackupEligible, BackupState: cred.Flags.BackupState,
		Transports: transportsOf(cred.Transport), Name: defaultName(cred.Authenticator.AAGUID), By: sub,
	})
	if errors.Is(err, pgx.ErrNoRows) { // the credential is already someone's
		return Passkey{}, ErrDuplicate
	}
	if err != nil {
		return Passkey{}, err
	}
	return Passkey{ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt.Time}, nil
}

// LoginOptions are the options for signing in with a Passkey: a discoverable
// ceremony, so the page or App knows no User yet. The challenge comes back
// for the caller to keep until the response arrives (the AuthnSession store
// on the hosted page, an auth_session in the direct API); rendering the first
// step again asks for a new one, which is what makes a replayed assertion
// fail.
func (s *Store) LoginOptions() (options json.RawMessage, challenge string, err error) {
	assertion, sd, err := s.wa.BeginDiscoverableLogin()
	if err != nil {
		return nil, "", err
	}
	if options, err = json.Marshal(assertion); err != nil {
		return nil, "", err
	}
	return options, sd.Challenge, nil
}

// SignIn is one of a User's Passkeys signing them in: the assertion response
// checked against the challenge LoginOptions issued. BackupEligible says
// which key the amr claim names the login by: a synced Passkey is a software
// key, one that never leaves its device a hardware one. Nothing here creates
// a User; a Passkey only ever signs in the User it was added to.
func (s *Store) SignIn(ctx context.Context, challenge string, response []byte) (SignIn, error) {
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return SignIn{}, ErrLoginFail
	}
	wa, err := s.authn(ctx)
	if err != nil {
		return SignIn{}, err
	}
	var owner *sqlc.PasskeyByCredentialIDRow
	var lookupErr error // go-webauthn wraps the handler's error; ours is the clearer
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		row, err := s.q.PasskeyByCredentialID(ctx, rawID)
		if errors.Is(err, pgx.ErrNoRows) {
			lookupErr = ErrNoPasskey
			return nil, ErrNoPasskey
		} else if err != nil {
			lookupErr = err
			return nil, err
		}
		// The credential belongs to the User its handle names, or to nobody.
		if !bytes.Equal(userHandle, []byte(row.UserID)) {
			lookupErr = ErrNoPasskey
			return nil, ErrNoPasskey
		}
		owner = &row
		return loginuser{sub: row.UserID, credential: webauthn.Credential{
			ID: rawID, PublicKey: row.PublicKey,
			Authenticator: webauthn.Authenticator{SignCount: uint32(row.SignCount)},
			Flags:         webauthn.CredentialFlags{BackupEligible: row.BackupEligible, BackupState: row.BackupState},
		}}, nil
	}
	// ponytail: no deadline of its own; the challenge's holder (AuthnSession,
	// auth_session) is what expires it.
	sd := webauthn.SessionData{
		Challenge: challenge, RelyingPartyID: s.rpID(),
		UserVerification: protocol.VerificationRequired,
	}
	_, cred, err := wa.ValidatePasskeyLogin(handler, sd, parsed)
	if lookupErr != nil {
		return SignIn{}, lookupErr
	}
	if owner != nil && cred != nil && cred.Authenticator.CloneWarning {
		if err := s.q.AuditPasskeyCounter(ctx, sqlc.AuditPasskeyCounterParams{
			Sub: owner.UserID, Name: owner.Name, Count: int64(parsed.Response.AuthenticatorData.Counter),
		}); err != nil {
			return SignIn{}, err
		}
		return SignIn{}, ErrCloned
	}
	if err != nil {
		var invalid identity.Invalid
		if errors.As(err, &invalid) {
			return SignIn{}, invalid
		}
		return SignIn{}, ErrLoginFail
	}
	if err := s.q.SignInPasskey(ctx, sqlc.SignInPasskeyParams{
		CredentialID: parsed.RawID, SignCount: int64(cred.Authenticator.SignCount),
	}); err != nil {
		return SignIn{}, err
	}
	return SignIn{Sub: owner.UserID, BackupEligible: cred.Flags.BackupEligible}, nil
}

// SignIn is what a passing assertion says: who signed in, and with what kind
// of Passkey.
type SignIn struct {
	Sub            string
	BackupEligible bool
}

// loginuser is a User as a login ceremony sees one: one credential of
// theirs, the one the assertion names.
type loginuser struct {
	sub        string
	credential webauthn.Credential
}

func (u loginuser) WebAuthnID() []byte          { return []byte(u.sub) }
func (u loginuser) WebAuthnName() string        { return u.sub }
func (u loginuser) WebAuthnDisplayName() string { return u.sub }
func (u loginuser) WebAuthnCredentials() []webauthn.Credential {
	return []webauthn.Credential{u.credential}
}

// Rename gives one of the User's Passkeys a name they know it by.
func (s *Store) Rename(ctx context.Context, sub, id, name, by string) error {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return ErrName
	}
	n, err := s.q.RenamePasskey(ctx, sqlc.RenamePasskeyParams{By: by, Name: name, ID: id, UserID: sub})
	if err == nil && n == 0 {
		err = ErrGone
	}
	return err
}

// Remove deletes one of the User's Passkeys.
func (s *Store) Remove(ctx context.Context, sub, id, by string) error {
	n, err := s.q.DeletePasskey(ctx, sqlc.DeletePasskeyParams{By: by, ID: id, UserID: sub})
	if err == nil && n == 0 {
		err = ErrGone
	}
	return err
}

// RegisterWellKnown serves /.well-known/passkey-endpoints, where password
// managers look up where to add and manage Passkeys.
func (s *Store) RegisterWellKnown(mux *http.ServeMux) {
	mux.HandleFunc("GET /.well-known/passkey-endpoints", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"enroll": s.issuer + "/account#passkeys",
			"manage": s.issuer + "/account#passkeys",
		})
	})
}

// DeleteExpired drops registration challenges past their TTL; the hourly
// cleanup runs it.
func DeleteExpired(ctx context.Context, pool *pgxpool.Pool) error {
	return sqlc.New(pool).DeleteExpiredPasskeyChallenges(ctx)
}

func (s *Store) rpID() string { return s.wa.Config.RPID }

// authn is the WebAuthn a Passkey ceremony verifies with: s.wa, or — once an
// Application has registered an Android app — a copy that takes that app's
// assertions too. The registered fingerprints are read here rather than
// cached, so one added or removed applies to the next ceremony (ADR 0014).
func (s *Store) authn(ctx context.Context) (*webauthn.WebAuthn, error) {
	rows, err := s.q.ListApplications(ctx, "")
	if err != nil {
		return nil, err
	}
	var origins []string
	for _, r := range rows {
		var apps []struct {
			SHA256CertFingerprints []string `json:"sha256CertFingerprints"`
		}
		if err := json.Unmarshal(r.AndroidApps, &apps); err != nil {
			continue // a row the Management API did not write
		}
		for _, app := range apps {
			for _, f := range app.SHA256CertFingerprints {
				if origin, ok := androidOrigin(f); ok {
					origins = append(origins, origin)
				}
			}
		}
	}
	if len(origins) == 0 {
		return s.wa, nil
	}
	// The config was validated when the Store was built; only the origins an
	// Android app conveys are added, so only those need no checking here.
	cfg := *s.wa.Config
	cfg.RPOpaqueOrigins = origins
	return &webauthn.WebAuthn{Config: &cfg}, nil
}

// androidOrigin is the origin an Android app with this SHA-256 signing
// certificate conveys in clientDataJSON: android:apk-key-hash: and the
// certificate's bytes, base64url. A fingerprint that is not one is skipped:
// the Management API validates them, so this is a row it did not write.
func androidOrigin(fingerprint string) (string, bool) {
	raw, err := hex.DecodeString(strings.ReplaceAll(fingerprint, ":", ""))
	if err != nil || len(raw) != sha256.Size {
		return "", false
	}
	return "android:apk-key-hash:" + base64.RawURLEncoding.EncodeToString(raw), true
}

// defaultName is a new Passkey's: its authenticator's name, or "Passkey"
// when the AAGUID says none.
func defaultName(aaguid []byte) string {
	if len(aaguid) == 16 {
		if name, ok := aaguidNames[uuid.UUID(*(*[16]byte)(aaguid)).String()]; ok {
			return name
		}
	}
	return "Passkey"
}

func uuidToPG(b []byte) pgtype.UUID {
	var u pgtype.UUID
	if len(b) == 16 {
		u.Bytes, u.Valid = *(*[16]byte)(b), true
	}
	return u
}

func transportsOf(ts []protocol.AuthenticatorTransport) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = string(t)
	}
	return out
}
