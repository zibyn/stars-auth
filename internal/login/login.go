// Package login serves the hosted pages a browser signs in through: the OIDC
// provider with its login page, browser Sessions, and the first-start setup
// page; and the direct auth API Apps sign in through.
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
	"regexp"
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

//go:embed pages.html altcha challenge.openapi.json
var pagesFS embed.FS

var pages = template.Must(template.ParseFS(pagesFS, "pages.html"))

const (
	sessionCookie = "__Host-session"

	// Keys in the AuthnSession store, carried into the grant.
	storeAuthTime = "auth_time"
	storeAMR      = "amr"
	// Set instead of a grant while a User past the first factor must still
	// bind a phone number or agree to the terms; with auth_time and amr, and
	// the Session only if the browser already had one.
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

// AccountClientID is the built-in Application the account center signs in as.
const AccountClientID = "stars-auth-account"

// New builds the provider and points the redirect URIs of the console and
// the account center at issuer, which only the running instance knows.
func New(ctx context.Context, pool *pgxpool.Pool, keyring *crypt.Keyring, issuer string) (*Service, error) {
	for client, path := range map[string]string{ConsoleClientID: "/console", AccountClientID: "/account"} {
		if err := sqlc.New(pool).SetRedirectURIs(ctx, sqlc.SetRedirectURIsParams{
			ClientID:               client,
			RedirectUris:           []string{issuer + path + "/callback"},
			PostLogoutRedirectUris: []string{issuer + path},
		}); err != nil {
			return nil, err
		}
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
			provider.WithAuthorizationChallengeEndpoint(ChallengePath),
			provider.WithAuthPolicies(goidc.NewPolicy("password",
				func(*http.Request, *goidc.AuthnSession, *goidc.Client) bool { return true },
				s.authenticate)),
		),
		provider.WithRefreshTokenGrant(store, provider.WithRefreshTokenRotation()),
		// Access tokens are JWTs and not stored: revoking one does nothing,
		// and they lapse within their 10 minutes.
		provider.WithTokenRevocation(func(context.Context, *goidc.Client) bool { return true }),
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
		provider.WithLogout(provider.LogoutConfig{
			Manager: store,
			HandleFunc: func(w http.ResponseWriter, _ *http.Request, _ *goidc.LogoutSession) error {
				page(w, http.StatusOK, "message", "已退出登录")
				return nil
			},
		}, provider.WithLogoutPolicies(goidc.NewLogoutPolicy("session",
			func(*http.Request, *goidc.LogoutSession) bool { return true },
			s.logout))),
		provider.WithErrorRenderer(renderError),
		provider.WithErrorHandler(func(_ context.Context, err error) { slog.Info("oidc", "err", err) }),
	)
	if err != nil {
		return nil, err
	}
	s.op = op
	return s, nil
}

// Register adds the OIDC endpoints, the direct auth API and the setup page
// to mux.
func (s *Service) Register(mux *http.ServeMux) {
	s.op.RegisterRoutes(mux)
	mux.HandleFunc("GET /altcha/challenge", s.pow.ServeChallenge)
	mux.HandleFunc("GET /altcha/altcha.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFileFS(w, r, pagesFS, "altcha/altcha.js")
	})
	mux.HandleFunc("POST "+ChallengePath, s.challenge)
	mux.HandleFunc("GET /v1/auth/terms", s.terms)
	mux.HandleFunc("GET /v1/auth/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, pagesFS, "challenge.openapi.json")
	})
	mux.HandleFunc("GET /setup", s.setupPage)
	mux.HandleFunc("POST /setup", s.setup)
}

// audience makes an access token for the Application's default API, with
// the User's Roles there (RFC 9068 §2.2.3.1), read as they stand now. It
// names the Session it was issued in as sid.
// ponytail: two PG reads per token; fold into Client if it shows up.
func (s *Service) audience(ctx context.Context, _ *goidc.Token, g *goidc.Grant) map[string]any {
	claims := map[string]any{}
	if sid, ok := g.Store[oidcstore.SessionKey].(string); ok {
		claims["sid"] = sid
	}
	app, err := s.q.Application(ctx, g.ClientID)
	if err != nil || !app.DefaultApi.Valid {
		return claims
	}
	claims[goidc.ClaimAudience] = app.DefaultApi.String
	r, err := s.q.TokenRoles(ctx, sqlc.TokenRolesParams{UserID: g.Subject, Api: app.DefaultApi.String})
	if err != nil {
		slog.Error("token roles", "err", err)
		return claims
	}
	if len(r.Roles) > 0 {
		claims["roles"], claims["entitlements"] = r.Roles, r.Entitlements
	}
	return claims
}

// DeleteOldSessions removes Sessions ended or idle for over 30 days; run by
// the hourly cleanup.
func DeleteOldSessions(ctx context.Context, pool *pgxpool.Pool) error {
	return sqlc.New(pool).DeleteOldSessions(ctx)
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
			if needs, err := s.q.NeedsConsent(r.Context(), sess.UserID); err != nil {
				return goidc.StatusFailure, err
			} else if needs {
				return goidc.StatusFailure, goidc.NewError(goidc.ErrorCodeInteractionRequired, "the terms must be agreed to first")
			}
		}
		return s.complete(w, r, as, c, sess.ID, sess.UserID, sess.AuthTime.Time, sess.Amr)
	}
	if none {
		return goidc.StatusFailure, goidc.NewError(goidc.ErrorCodeLoginRequired, "login required")
	}
	// The page's links: ?password for the password form, ?identifier to
	// send a code again.
	q := r.URL.Query()
	return s.render(w, r, as, c, loginPage{PasswordForm: q.Has("password"), Identifier: q.Get("identifier")})
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
	form := loginPage{Identifier: r.PostFormValue("identifier"), Username: r.PostFormValue("username"), PasswordForm: r.PostFormValue("mode") == "password"}
	if err := s.origin.Check(r); err != nil {
		form.Error = "请从登录页提交"
		return s.render(w, r, as, c, form)
	}
	pending, _ := as.Store[storeBindSub].(string)
	pendingSession, _ := as.Store[oidcstore.SessionKey].(string)
	pendingAuthTime, _ := as.Store[storeAuthTime].(int64)
	terms, err := s.q.Terms(ctx)
	if err != nil {
		return goidc.StatusFailure, err
	}
	// Ticking the box posts the version shown; a stale page agrees to nothing.
	agreed := terms.TermsVersion == "" || r.PostFormValue("agree") == terms.TermsVersion
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
		if pending == "" && !agreed {
			return fail(errAgree)
		}
		if err != nil && pending == "" && !codeLike.MatchString(strings.TrimSpace(form.Identifier)) {
			// Not shaped like a phone number or email: a username, which
			// signs in by password. Whether it exists is not told.
			if setting, err := s.q.PasswordLogin(ctx); err != nil {
				return goidc.StatusFailure, err
			} else if setting == "off" {
				return fail(errNoCode)
			}
			form.Username, form.Identifier = strings.TrimSpace(form.Identifier), ""
			return s.render(w, r, as, c, form)
		}
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
		if pending == "" && !agreed {
			return fail(errAgree)
		}
		if err := s.ids.FromIP(ctx, clientIP(r), func() error { return s.codes.Check(ctx, value, r.PostFormValue("code")) }); err != nil {
			return fail(err)
		}
		if pending != "" {
			if kind != "phone" {
				return fail(identity.ErrPhone)
			}
			if err := s.ids.AddIdentifier(ctx, pending, kind, value); err != nil {
				return fail(err)
			}
			return s.complete(w, r, as, c, pendingSession, pending, time.Unix(pendingAuthTime, 0), storedAMR(as.Store[storeAMR]))
		}
		sub, err := s.ids.SignIn(ctx, kind, value)
		if err != nil {
			return fail(err)
		}
		return s.login(w, r, as, c, sub, codeAMR(kind), terms.TermsVersion)

	case "password":
		if pending != "" {
			break
		}
		if !agreed {
			form.PasswordForm = true // back to the form with the box to tick
			return fail(errAgree)
		}
		var sub string
		if err := s.ids.FromIP(ctx, clientIP(r), func() (err error) {
			sub, err = s.ids.CheckPassword(ctx, form.Username, r.PostFormValue("password"))
			return err
		}); err != nil {
			return fail(err)
		}
		return s.login(w, r, as, c, sub, goidc.AMRPassword, terms.TermsVersion)

	case "consent":
		if pending == "" {
			break
		}
		if !agreed {
			return fail(errAgree)
		}
		if terms.TermsVersion != "" {
			if err := s.q.RecordConsent(ctx, sqlc.RecordConsentParams{UserID: pending, Version: terms.TermsVersion, ClientID: c.ID}); err != nil {
				return goidc.StatusFailure, err
			}
		}
		return s.complete(w, r, as, c, pendingSession, pending, time.Unix(pendingAuthTime, 0), storedAMR(as.Store[storeAMR]))
	}
	return s.render(w, r, as, c, loginPage{})
}

// codeLike is what the page takes for a phone number or email, and runs the
// PoW for; pages.html tests the same.
var codeLike = regexp.MustCompile(`@|^[\d\s+-]+$`)

var (
	errAgree  = identity.Invalid("请先阅读并同意用户协议和隐私政策")
	errNoCode = identity.Invalid("该账号不能用验证码登录")
)

// login goes on with a User who just passed the first factor, having agreed
// to the terms of version (if any).
func (s *Service) login(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client, sub string, amr goidc.AMR, version string) (goidc.Status, error) {
	if version != "" {
		if err := s.q.RecordConsent(r.Context(), sqlc.RecordConsentParams{UserID: sub, Version: version, ClientID: c.ID}); err != nil {
			return goidc.StatusFailure, err
		}
	}
	return s.complete(w, r, as, c, "", sub, time.Now(), []string{string(amr)})
}

// complete grants sub, unless sub has yet to agree to the current terms or
// to bind the phone number the instance requires: then those pages come
// first. Until they are done, the login waits in the AuthnSession store and
// the browser holds no Session; session is empty unless the browser already
// had one, and the Session starts once nothing is left.
func (s *Service) complete(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client, session, sub string, authTime time.Time, amr []string) (goidc.Status, error) {
	phone, err := s.q.NeedsPhone(r.Context(), sub)
	if err != nil {
		return goidc.StatusFailure, err
	}
	consent, err := s.q.NeedsConsent(r.Context(), sub)
	if err != nil {
		return goidc.StatusFailure, err
	}
	if phone || consent {
		as.Store = map[string]any{storeBindSub: sub, storeAuthTime: authTime.Unix(), storeAMR: amr}
		if session != "" {
			as.Store[oidcstore.SessionKey] = session
		}
		return s.render(w, r, as, c, loginPage{})
	}
	if session == "" {
		if session, err = s.newSession(w, r, c.ID, sub, authTime, amr); err != nil {
			return goidc.StatusFailure, err
		}
	}
	grant(as, session, sub, authTime, amr)
	return goidc.StatusSuccess, nil
}

// logout is RP-Initiated Logout: it ends the browser Session, and with it
// the refresh tokens issued under it. Unless the Application proves the
// User with an ID token hint, the User confirms first, so that no other
// site can sign them out.
func (s *Service) logout(w http.ResponseWriter, r *http.Request, ls *goidc.LogoutSession) (goidc.Status, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return goidc.StatusSuccess, nil //nolint:nilerr // no cookie, nothing to end
	}
	sess, err := s.session(w, r)
	if err != nil {
		return goidc.StatusFailure, err
	} else if sess == nil {
		setSessionCookie(w, "", -1) // a dead Session's cookie
		return goidc.StatusSuccess, nil
	}
	hinted := ls.IDTokenHintClaims != nil && ls.IDTokenHintClaims.Subject == sess.UserID
	confirmed := r.Method == http.MethodPost && r.PathValue("callback") != "" &&
		r.PostFormValue("logout") == "1" && s.origin.Check(r) == nil
	if !hinted && !confirmed {
		page(w, http.StatusOK, "logout", "/logout/"+ls.ID)
		return goidc.StatusPending, nil
	}
	if err := s.q.EndBrowserSession(r.Context(), hash(cookie.Value)); err != nil {
		return goidc.StatusFailure, err
	}
	setSessionCookie(w, "", -1)
	return goidc.StatusSuccess, nil
}

// codeAMR is how a code to an Identifier of kind proves the User (RFC 8176).
func codeAMR(kind string) goidc.AMR {
	if kind == "email" {
		return goidc.AMROneTimePassword
	}
	return goidc.AMRSMS
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

// grant completes the AuthnSession for sub, signed in by the browser Session
// session. With no consent page, every requested scope is granted.
func grant(as *goidc.AuthnSession, session, sub string, authTime time.Time, amr []string) {
	as.Subject = sub
	as.GrantedScopes = as.Scopes
	as.Store = map[string]any{oidcstore.SessionKey: session, storeAuthTime: authTime.Unix(), storeAMR: amr}
}

// session returns the browser's live Session, sliding its idle timeout, or
// nil if there is none.
func (s *Service) session(w http.ResponseWriter, r *http.Request) (*sqlc.TouchSessionRow, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, nil //nolint:nilerr // no cookie, no Session
	}
	sess, err := s.q.TouchSession(r.Context(), hash(cookie.Value))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	setSessionCookie(w, cookie.Value, int(sess.IdleSecs))
	return &sess, nil
}

// newSession signs sub in on this browser, for clientID, and returns the
// Session id. The same User keeps their Session (and the refresh tokens
// under it) with a fresh cookie; another User's Session ends: a browser
// holds one User.
func (s *Service) newSession(w http.ResponseWriter, r *http.Request, clientID, sub string, authTime time.Time, amr []string) (string, error) {
	token := rand.Text()
	if old, err := r.Cookie(sessionCookie); err == nil {
		sess, err := s.q.RenewSession(r.Context(), sqlc.RenewSessionParams{
			OldHash: hash(old.Value), NewHash: hash(token), UserID: sub,
			AuthTime: pgtype.Timestamptz{Time: authTime, Valid: true}, Amr: amr,
		})
		if err == nil {
			setSessionCookie(w, token, int(sess.IdleSecs))
			return sess.ID, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if err := s.q.EndBrowserSession(r.Context(), hash(old.Value)); err != nil {
			return "", err
		}
	}
	sess, err := s.q.CreateSession(r.Context(), sqlc.CreateSessionParams{
		IDHash:   hash(token),
		ClientID: clientID,
		UserID:   sub,
		AuthTime: pgtype.Timestamptz{Time: authTime, Valid: true},
		Amr:      amr,
	})
	if err != nil {
		return "", err
	}
	setSessionCookie(w, token, int(sess.IdleSecs))
	return sess.ID, nil
}

// setSessionCookie keeps the cookie as long as the Session's idle timeout;
// maxAge -1 deletes it.
func setSessionCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func hash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

type loginPage struct {
	Client, Action, Error string
	Terms                 sqlc.TermsRow
	// Consent: a signed-in User must agree to new terms before going on;
	// then Bind: they must bind a phone number.
	Consent, Bind bool
	// CodeKinds names what codes can go to ("手机号", "邮箱" or both); empty
	// when no Channel is enabled. IdentifierLabel adds usernames when
	// PasswordOn: password login is not off.
	CodeKinds, IdentifierLabel string
	PasswordOn                 bool
	// The steps: the first asks for an Identifier, then a code was sent to
	// it (CodeSent) or it was a Username, which takes a password.
	// PasswordForm takes both at once.
	Identifier   string
	CodeSent     bool
	Username     string
	PasswordForm bool
}

func (s *Service) render(w http.ResponseWriter, r *http.Request, as *goidc.AuthnSession, c *goidc.Client, p loginPage) (goidc.Status, error) {
	p.Client, p.Action = c.Name, "/authorize/"+as.ID
	ctx := r.Context()
	if pending, ok := as.Store[storeBindSub].(string); ok {
		consent, err := s.q.NeedsConsent(ctx, pending)
		if err != nil {
			return goidc.StatusFailure, err
		}
		phone, err := s.q.NeedsPhone(ctx, pending)
		if err != nil {
			return goidc.StatusFailure, err
		}
		// Neither left (the admin changed the policy meanwhile): the consent
		// page, with no terms to tick, just lets the User go on.
		p.Consent, p.Bind = consent || !phone, !consent && phone
	}
	terms, err := s.q.Terms(ctx)
	if err != nil {
		return goidc.StatusFailure, err
	}
	p.Terms = terms
	setting, err := s.q.PasswordLogin(ctx)
	if err != nil {
		return goidc.StatusFailure, err
	}
	p.PasswordOn = setting != "off"
	kinds, err := s.q.ChannelKinds(ctx)
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
	p.IdentifierLabel = p.CodeKinds
	if p.PasswordOn && !p.Bind {
		p.IdentifierLabel = strings.Replace(p.CodeKinds, "或", "、", 1) + "或用户名"
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
