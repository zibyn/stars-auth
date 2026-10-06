// Package login serves the hosted pages a browser signs in through: the OIDC
// provider with its login page, browser Sessions, and the first-start setup
// page.
package login

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"errors"
	"html/template"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/oidc/provider"
	"github.com/zibyn/stars-auth/internal/oidcstore"
)

//go:embed pages.html
var pagesFS embed.FS

var pages = template.Must(template.ParseFS(pagesFS, "pages.html"))

const (
	sessionCookie = "__Host-session"
	sessionIdle   = 30 * 24 * time.Hour // a browser Session dies after this long unused

	// Keys in the AuthnSession store, carried into the grant.
	storeAuthTime = "auth_time"
	storeAMR      = "amr"
)

type Service struct {
	issuer string
	q      *sqlc.Queries
	ids    *identity.Store
	op     *provider.Provider
	origin *http.CrossOriginProtection
}

// ConsoleClientID is the built-in Application the admin console signs in as.
const ConsoleClientID = "stars-auth-console"

// New builds the provider and points the console's redirect URIs at issuer,
// which only the running instance knows.
func New(ctx context.Context, pool *pgxpool.Pool, keyring *crypt.Keyring, issuer string) (*Service, error) {
	if err := sqlc.New(pool).SetRedirectURIs(ctx, sqlc.SetRedirectURIsParams{
		ClientID:               ConsoleClientID,
		RedirectUris:           []string{issuer + "/console/callback"},
		PostLogoutRedirectUris: []string{issuer + "/console"},
	}); err != nil {
		return nil, err
	}
	s := &Service{
		issuer: issuer,
		q:      sqlc.New(pool),
		ids:    identity.New(pool, keyring),
		origin: http.NewCrossOriginProtection(),
	}
	store := oidcstore.New(pool, keyring)
	store.Scopes = goidc.ScopeOpenID.ID + " " + goidc.ScopeOfflineAccess.ID
	op, err := provider.New(
		provider.Config{
			Issuer:      issuer,
			Manager:     store,
			JWKS:        oidcstore.NewKeys(pool, keyring).JWKS,
			IDTokenAlgs: []goidc.SignatureAlgorithm{goidc.SigAlgRS256},
		},
		provider.WithScopes(goidc.ScopeOpenID, goidc.ScopeOfflineAccess),
		provider.WithNoneAuthn(),
		provider.WithSecretBasicAuthn(),
		provider.WithSecretPostAuthn(),
		provider.WithClientManager(store),
		provider.WithClientSecretVerifier(oidcstore.VerifyClientSecret),
		provider.WithAuthCodeGrant(
			provider.AuthCodeGrantConfig{Manager: store, ResponseTypes: []goidc.ResponseType{goidc.ResponseTypeCode}},
			provider.WithPKCE([]goidc.CodeChallengeMethod{goidc.CodeChallengeMethodSHA256}),
			provider.WithIssuerResponseParameter(),
			provider.WithAuthPolicies(goidc.NewPolicy("password",
				func(*http.Request, *goidc.AuthnSession, *goidc.Client) bool { return true },
				s.authenticate)),
		),
		provider.WithRefreshTokenGrant(store),
		provider.WithTokenOptions(func(context.Context, *goidc.Grant, *goidc.Client) goidc.TokenOptions {
			return goidc.NewJWTTokenOptions(goidc.SigAlgRS256, 600)
		}),
		provider.WithTokenClaims(s.audience),
		provider.WithIDTokenClaims(func(_ context.Context, g *goidc.Grant) map[string]any {
			return map[string]any{goidc.ClaimAuthTime: g.Store[storeAuthTime], goidc.ClaimAMR: g.Store[storeAMR]}
		}),
		provider.WithErrorRenderer(renderError),
		provider.WithErrorHandler(func(_ context.Context, err error) { slog.Info("oidc", "err", err) }),
	)
	if err != nil {
		return nil, err
	}
	s.op = op
	return s, nil
}

// Register adds the OIDC endpoints and the setup page to mux.
func (s *Service) Register(mux *http.ServeMux) {
	s.op.RegisterRoutes(mux)
	mux.HandleFunc("GET /setup", s.setupPage)
	mux.HandleFunc("POST /setup", s.setup)
}

// audience makes an access token for the Application's default API.
// ponytail: one PG read per token; fold into Client if it shows up.
func (s *Service) audience(ctx context.Context, _ *goidc.Token, g *goidc.Grant) map[string]any {
	app, err := s.q.Application(ctx, g.ClientID)
	if err != nil || !app.DefaultApi.Valid {
		return nil
	}
	return map[string]any{goidc.ClaimAudience: app.DefaultApi.String}
}

// DeleteIdleSessions removes browser Sessions past their idle timeout; run
// by the hourly cleanup.
func DeleteIdleSessions(ctx context.Context, pool *pgxpool.Pool) error {
	return sqlc.New(pool).DeleteIdleSessions(ctx, idleSince())
}

// authenticate is the hosted login: a live browser Session signs the User in
// silently unless the request demands a fresh login; otherwise the username
// and password form.
func (s *Service) authenticate(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client) (goidc.Status, error) {
	// Only the login form posts to the callback; the authorization request
	// itself may arrive as a cross-site POST.
	if r.Method == http.MethodPost && r.PathValue("callback") != "" {
		return s.submit(w, r, as, c)
	}
	prompts := strings.Fields(string(as.Prompt))
	none := slices.Contains(prompts, string(goidc.PromptTypeNone))
	if none && len(prompts) > 1 {
		return goidc.StatusFailure, goidc.NewError(goidc.ErrorCodeInvalidRequest, "prompt=none cannot be combined with other values")
	}
	sess, err := s.session(w, r)
	if err != nil {
		return goidc.StatusFailure, err
	}
	if sess != nil && !mustLogin(as, sess) {
		grant(as, sess.UserID, sess.AuthTime.Time, sess.Amr)
		return goidc.StatusSuccess, nil
	}
	if none {
		return goidc.StatusFailure, goidc.NewError(goidc.ErrorCodeLoginRequired, "login required")
	}
	return render(w, as, c, "", "")
}

// mustLogin reports whether the request rules out the existing Session.
// prompt=select_account counts as login: a browser holds one User.
func mustLogin(as *goidc.AuthnSession, sess *sqlc.TouchSessionRow) bool {
	for _, p := range strings.Fields(string(as.Prompt)) {
		if p == string(goidc.PromptTypeLogin) || p == string(goidc.PromptTypeSelectAccount) {
			return true
		}
	}
	if as.MaxAuthnAgeSecs != nil {
		// max_age=0 is prompt=login (Core errata); otherwise re-auth past the age.
		max := time.Duration(*as.MaxAuthnAgeSecs) * time.Second
		if max == 0 || time.Since(sess.AuthTime.Time) > max {
			return true
		}
	}
	return as.IDTokenHintClaims != nil && as.IDTokenHintClaims.Subject != sess.UserID
}

func (s *Service) submit(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client) (goidc.Status, error) {
	username := r.PostFormValue("username")
	if err := s.origin.Check(r); err != nil {
		return render(w, as, c, username, "请从登录页提交")
	}
	sub, err := s.ids.CheckPassword(r.Context(), username, r.PostFormValue("password"))
	var invalid identity.Invalid
	if errors.As(err, &invalid) {
		return render(w, as, c, username, invalid.Error())
	} else if err != nil {
		return goidc.StatusFailure, err
	}
	amr := []string{string(goidc.AMRPassword)}
	authTime := time.Now()
	if err := s.newSession(w, r, sub, authTime, amr); err != nil {
		return goidc.StatusFailure, err
	}
	grant(as, sub, authTime, amr)
	return goidc.StatusSuccess, nil
}

// grant completes the AuthnSession for sub. With no consent page, every
// requested scope is granted.
func grant(as *goidc.AuthnSession, sub string, authTime time.Time, amr []string) {
	as.Subject = sub
	as.GrantedScopes = as.Scopes
	as.Store = map[string]any{storeAuthTime: authTime.Unix(), storeAMR: amr}
}

// session returns the browser's live Session, sliding its idle timeout, or
// nil if there is none.
func (s *Service) session(w http.ResponseWriter, r *http.Request) (*sqlc.TouchSessionRow, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, nil //nolint:nilerr // no cookie, no Session
	}
	sess, err := s.q.TouchSession(r.Context(), sqlc.TouchSessionParams{IDHash: hash(cookie.Value), IdleSince: idleSince()})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	setSessionCookie(w, cookie.Value)
	return &sess, nil
}

// newSession starts a browser Session, replacing the one the browser had:
// a browser holds one User.
func (s *Service) newSession(w http.ResponseWriter, r *http.Request, sub string, authTime time.Time, amr []string) error {
	if old, err := r.Cookie(sessionCookie); err == nil {
		if err := s.q.DeleteSession(r.Context(), hash(old.Value)); err != nil {
			return err
		}
	}
	token := rand.Text()
	if err := s.q.CreateSession(r.Context(), sqlc.CreateSessionParams{
		IDHash:   hash(token),
		UserID:   sub,
		AuthTime: pgtype.Timestamptz{Time: authTime, Valid: true},
		Amr:      amr,
	}); err != nil {
		return err
	}
	setSessionCookie(w, token)
	return nil
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionIdle.Seconds()),
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func idleSince() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Now().Add(-sessionIdle), Valid: true}
}

func hash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

type loginPage struct {
	Client, Action, Username, Error string
}

func render(w http.ResponseWriter, as *goidc.AuthnSession, c *goidc.Client, username, msg string) (goidc.Status, error) {
	page(w, http.StatusOK, "login", loginPage{
		Client:   c.Name,
		Action:   "/authorize/" + as.ID,
		Username: username,
		Error:    msg,
	})
	return goidc.StatusPending, nil
}

// renderError shows an authorization error that cannot go back to the
// Application (unknown client, bad redirect_uri).
func renderError(w http.ResponseWriter, _ *http.Request, err error) error {
	msg := "请求无效"
	var oidcErr goidc.Error
	if errors.As(err, &oidcErr) {
		msg = oidcErr.Description
	}
	page(w, http.StatusBadRequest, "message", msg)
	return nil
}

func page(w http.ResponseWriter, status int, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
	w.WriteHeader(status)
	if err := pages.ExecuteTemplate(w, name, data); err != nil {
		slog.Error("render", "page", name, "err", err)
	}
}
