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
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/channel"
	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/oidc/provider"
	"github.com/zibyn/stars-auth/internal/oidcstore"
	"github.com/zibyn/stars-auth/internal/otp"
	"github.com/zibyn/stars-auth/internal/pow"
)

//go:embed pages.html altcha
var pagesFS embed.FS

var pages = template.Must(template.ParseFS(pagesFS, "pages.html"))

const (
	sessionCookie = "__Host-session"
	sessionIdle   = 30 * 24 * time.Hour // a browser Session dies after this long unused

	// Keys in the AuthnSession store, carried into the grant.
	storeAuthTime = "auth_time"
	storeAMR      = "amr"
	// Set instead of a grant while a signed-in User must bind a phone number.
	storeBindSub = "pending_sub"
)

type Service struct {
	issuer string
	q      *sqlc.Queries
	ids    *identity.Store
	codes  *otp.Service
	pow    *pow.PoW
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
	work, err := pow.New(ctx, pool)
	if err != nil {
		return nil, err
	}
	s := &Service{
		issuer: issuer,
		q:      sqlc.New(pool),
		ids:    identity.New(pool, keyring),
		codes:  otp.New(pool, channel.NewStore(pool, keyring)),
		pow:    work,
		origin: http.NewCrossOriginProtection(),
	}
	store := oidcstore.New(pool, keyring)
	store.Scopes = strings.Join([]string{goidc.ScopeOpenID.ID, goidc.ScopeOfflineAccess.ID, goidc.ScopePhone.ID, goidc.ScopeEmail.ID}, " ")
	op, err := provider.New(
		provider.Config{
			Issuer:      issuer,
			Manager:     store,
			JWKS:        oidcstore.NewKeys(pool, keyring).JWKS,
			IDTokenAlgs: []goidc.SignatureAlgorithm{goidc.SigAlgRS256},
		},
		provider.WithScopes(goidc.ScopeOpenID, goidc.ScopeOfflineAccess, goidc.ScopePhone, goidc.ScopeEmail),
		provider.WithClaims(goidc.ClaimPhoneNumber, goidc.ClaimPhoneNumberVerified, goidc.ClaimEmail, goidc.ClaimEmailVerified),
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
		provider.WithIDTokenClaims(func(ctx context.Context, g *goidc.Grant) map[string]any {
			claims := s.userClaims(ctx, g)
			claims[goidc.ClaimAuthTime] = g.Store[storeAuthTime]
			claims[goidc.ClaimAMR] = g.Store[storeAMR]
			return claims
		}),
		provider.WithUserInfoClaims(s.userClaims),
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
	mux.HandleFunc("GET /altcha/challenge", s.pow.ServeChallenge)
	mux.HandleFunc("GET /altcha/altcha.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFileFS(w, r, pagesFS, "altcha/altcha.js")
	})
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
// silently unless the request demands a fresh login; otherwise the code and
// password forms.
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
		if none {
			if needs, err := s.q.NeedsPhone(r.Context(), sess.UserID); err != nil {
				return goidc.StatusFailure, err
			} else if needs {
				return goidc.StatusFailure, goidc.NewError(goidc.ErrorCodeInteractionRequired, "a phone number must be bound first")
			}
		}
		return s.complete(w, r, as, c, sess.UserID, sess.AuthTime.Time, sess.Amr)
	}
	if none {
		return goidc.StatusFailure, goidc.NewError(goidc.ErrorCodeLoginRequired, "login required")
	}
	return s.render(w, r, as, c, loginPage{})
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
	ctx := r.Context()
	form := loginPage{Identifier: r.PostFormValue("identifier"), Username: r.PostFormValue("username")}
	if err := s.origin.Check(r); err != nil {
		form.Error = "请从登录页提交"
		return s.render(w, r, as, c, form)
	}
	pending, _ := as.Store[storeBindSub].(string)
	// fail shows a mistake on the page, or ends the login on any other error.
	fail := func(err error) (goidc.Status, error) {
		var invalid identity.Invalid
		if !errors.As(err, &invalid) {
			return goidc.StatusFailure, err
		}
		form.Error = invalid.Error()
		return s.render(w, r, as, c, form)
	}

	switch r.PostFormValue("op") {
	case "send":
		kind, value, err := identity.ParseIdentifier(form.Identifier)
		if err == nil && pending != "" && kind != "phone" {
			err = identity.ErrPhone
		}
		if err == nil {
			err = s.pow.Verify(ctx, r.PostFormValue("altcha"))
		}
		if err == nil {
			err = s.codes.Send(ctx, kind, value, clientIP(r))
		}
		if err != nil {
			return fail(err)
		}
		form.Identifier, form.CodeSent = value, true
		return s.render(w, r, as, c, form)

	case "verify":
		form.CodeSent = true
		kind, value, err := identity.ParseIdentifier(form.Identifier)
		if err != nil {
			return fail(err)
		}
		if err := s.codes.Check(ctx, value, r.PostFormValue("code")); err != nil {
			return fail(err)
		}
		if pending != "" {
			if kind != "phone" {
				return fail(identity.ErrPhone)
			}
			if err := s.ids.AddIdentifier(ctx, pending, kind, value); err != nil {
				return fail(err)
			}
			authTime, _ := as.Store[storeAuthTime].(int64)
			grant(as, pending, time.Unix(authTime, 0), storedAMR(as.Store[storeAMR]))
			return goidc.StatusSuccess, nil
		}
		sub, err := s.ids.SignIn(ctx, kind, value)
		if err != nil {
			return goidc.StatusFailure, err
		}
		amr := goidc.AMRSMS
		if kind == "email" {
			amr = goidc.AMROneTimePassword
		}
		return s.login(w, r, as, c, sub, amr)

	case "password":
		if pending != "" {
			break
		}
		sub, err := s.ids.CheckPassword(ctx, form.Username, r.PostFormValue("password"))
		if err != nil {
			return fail(err)
		}
		return s.login(w, r, as, c, sub, goidc.AMRPassword)
	}
	return s.render(w, r, as, c, loginPage{})
}

// login starts a browser Session for a User who just authenticated.
func (s *Service) login(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client, sub string, amr goidc.AMR) (goidc.Status, error) {
	authTime, amrs := time.Now(), []string{string(amr)}
	if err := s.newSession(w, r, sub, authTime, amrs); err != nil {
		return goidc.StatusFailure, err
	}
	return s.complete(w, r, as, c, sub, authTime, amrs)
}

// complete grants sub, unless the instance requires a phone number sub has
// not bound yet: then the bind page comes first.
func (s *Service) complete(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client, sub string, authTime time.Time, amr []string) (goidc.Status, error) {
	needs, err := s.q.NeedsPhone(r.Context(), sub)
	if err != nil {
		return goidc.StatusFailure, err
	}
	if needs {
		as.Store = map[string]any{storeBindSub: sub, storeAuthTime: authTime.Unix(), storeAMR: amr}
		return s.render(w, r, as, c, loginPage{})
	}
	grant(as, sub, authTime, amr)
	return goidc.StatusSuccess, nil
}

// storedAMR reads amr back from an AuthnSession store, where it was decoded
// from JSON.
func storedAMR(v any) []string {
	var out []string
	if vs, ok := v.([]any); ok {
		for _, x := range vs {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func clientIP(r *http.Request) string {
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		return ap.Addr().Unmap().String()
	}
	return r.RemoteAddr
}

// userClaims are the phone and email claims the grant's scopes ask for.
func (s *Service) userClaims(ctx context.Context, g *goidc.Grant) map[string]any {
	claims := map[string]any{}
	scopes := strings.Fields(g.Scopes)
	ids, err := s.q.UserIdentifiers(ctx, g.Subject)
	if err != nil {
		slog.Error("user claims", "err", err)
		return claims
	}
	for _, id := range ids {
		switch {
		case id.Kind == "phone" && slices.Contains(scopes, goidc.ScopePhone.ID):
			claims[goidc.ClaimPhoneNumber], claims[goidc.ClaimPhoneNumberVerified] = id.Value, true
		case id.Kind == "email" && slices.Contains(scopes, goidc.ScopeEmail.ID):
			claims[goidc.ClaimEmail], claims[goidc.ClaimEmailVerified] = id.Value, true
		}
	}
	return claims
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
	Client, Action, Error string
	// Bind: a signed-in User must bind a phone number before going on.
	Bind bool
	// CodeKinds names what codes can go to ("手机号", "邮箱" or both); empty
	// when no Channel is enabled.
	CodeKinds  string
	Identifier string
	CodeSent   bool
	Username   string
}

func (s *Service) render(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client, p loginPage) (goidc.Status, error) {
	p.Client, p.Action = c.Name, "/authorize/"+as.ID
	p.Bind = as.Store[storeBindSub] != nil
	kinds, err := s.q.ChannelKinds(r.Context())
	if err != nil {
		return goidc.StatusFailure, err
	}
	switch {
	case p.Bind && !slices.Contains(kinds, "phone"):
		p.Error = "需要绑定手机号,但短信通道未配置,请联系管理员"
	case p.Bind || slices.Equal(kinds, []string{"phone"}):
		p.CodeKinds = "手机号"
	case slices.Equal(kinds, []string{"email"}):
		p.CodeKinds = "邮箱"
	case len(kinds) == 2:
		p.CodeKinds = "手机号或邮箱"
	}
	page(w, http.StatusOK, "login", p)
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
