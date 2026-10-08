package login

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/oidcstore"
	"github.com/zibyn/stars-auth/internal/twofactor"
)

// ChallengePath is the direct auth API's authorization challenge endpoint
// (OAuth 2.0 for First-Party Applications, draft -04; ADR 0002).
const ChallengePath = "/v1/auth/challenge"

// Error codes of the draft beyond RFC 6749's.
const (
	errInvalidSession            = "invalid_session"
	errInsufficientAuthorization = "insufficient_authorization"
)

// Values of next (ADR 0010): only ever added to, never renamed or removed.
const (
	nextCode  = "code"  // enter the code just sent
	nextPhone = "phone" // bind a phone number first
	nextTOTP  = "totp"  // enter a TOTP code or a 恢复码
)

// challengeState is what an auth_session carries between requests.
type challengeState struct {
	Params goidc.AuthorizationParameters `json:"params"`
	// Identifier the last code went to.
	Identifier string `json:"identifier,omitempty"`
	// Set once the User has passed the first factor but must pass 两步验证
	// or bind a phone number.
	Pending *pendingLogin `json:"pending,omitempty"`
}

type pendingLogin struct {
	Sub      string   `json:"sub"`
	AuthTime int64    `json:"auth_time"`
	AMR      []string `json:"amr"`
	// TOTP: waiting for a TOTP code or a 恢复码, with Failures mistakes so far.
	TOTP     bool `json:"totp,omitempty"`
	Failures int  `json:"failures,omitempty"`
}

// challengeError is a draft error response; AuthSession lets the App go on.
type challengeError struct {
	status      int
	Code        string `json:"error"`
	Description string `json:"error_description,omitempty"`
	AuthSession string `json:"auth_session,omitempty"`
	// Next names the step an insufficient_authorization asks for (ADR 0010).
	Next string `json:"next,omitempty"`
}

func (e *challengeError) Error() string { return e.Code + ": " + e.Description }

// challenge is the direct auth API: an App signs a User in with a code or a
// password and gets an authorization code for /token. One request sends a
// code (identifier) and answers insufficient_authorization with an
// auth_session; the next enters it (auth_session + code). A password
// (username + password) takes one request.
func (s *Service) challenge(w http.ResponseWriter, r *http.Request) {
	code, err := s.runChallenge(w, r)
	var ce *challengeError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]string{"authorization_code": code})
		return
	case errors.As(err, &ce):
	default:
		var oe goidc.Error
		if errors.As(err, &oe) {
			ce = &challengeError{status: oe.StatusCode(), Code: string(oe.Code), Description: oe.Description}
			break
		}
		slog.Error("authorization challenge", "err", err)
		ce = &challengeError{status: http.StatusInternalServerError, Code: "server_error"}
	}
	writeJSON(w, ce.status, ce)
}

func (s *Service) runChallenge(w http.ResponseWriter, r *http.Request) (string, error) {
	ctx := r.Context()
	// Every request carries the version of the terms the User agreed to in
	// the App; with no terms set up, any version will do, none included.
	version := r.PostFormValue("terms_version")
	terms, err := s.q.Terms(ctx)
	if err != nil {
		return "", err
	}
	if terms.TermsVersion != "" && version != terms.TermsVersion {
		return "", invalid("terms_version is not the current one: " + terms.TermsVersion)
	}
	// A new sign-in sets the parameters; later requests carry them in the
	// auth_session.
	token := r.PostFormValue("auth_session")
	var st challengeState
	if token != "" {
		row, err := s.q.ChallengeSession(ctx, hash(token))
		if errors.Is(err, pgx.ErrNoRows) {
			return "", &challengeError{status: http.StatusBadRequest, Code: errInvalidSession, Description: "auth_session is invalid or expired"}
		} else if err != nil {
			return "", err
		}
		if err := json.Unmarshal(row.Data, &st); err != nil {
			return "", err
		}
		if r.PostFormValue("client_id") != "" && r.PostFormValue("client_id") != row.ClientID {
			return "", &challengeError{status: http.StatusBadRequest, Code: errInvalidSession, Description: "auth_session belongs to another client"}
		}
		// The draft lets the App leave client_id out of later requests.
		r.Form.Set("client_id", row.ClientID)
		r.PostForm.Set("client_id", row.ClientID)
	} else {
		if r.PostFormValue("response_type") != string(goidc.ResponseTypeCode) {
			return "", invalid("response_type must be code")
		}
		st.Params = goidc.AuthorizationParameters{
			ResponseType:        goidc.ResponseTypeCode,
			Scopes:              r.PostFormValue("scope"),
			CodeChallenge:       r.PostFormValue("code_challenge"),
			CodeChallengeMethod: goidc.CodeChallengeMethod(r.PostFormValue("code_challenge_method")),
		}
	}
	c, err := s.op.ChallengeClient(w, r, st.Params)
	if err != nil {
		return "", err
	}

	// save keeps st in the auth_session.
	save := func() error {
		if token == "" {
			token = newAuthSession()
		}
		data, err := json.Marshal(st)
		if err != nil {
			return err
		}
		return s.q.SaveChallengeSession(ctx, sqlc.SaveChallengeSessionParams{Hash: hash(token), ClientID: c.ID, Data: data})
	}
	// next keeps the sign-in going: the App must take another step.
	next := func(step, description string) (string, error) {
		if err := save(); err != nil {
			return "", err
		}
		return "", &challengeError{status: http.StatusForbidden, Code: errInsufficientAuthorization, Description: description, AuthSession: token, Next: step}
	}
	// signedIn ends the sign-in with an authorization code, unless sub must
	// pass 两步验证 or bind a phone number first, in that order.
	signedIn := func(sub string, authTime time.Time, amr []string) (string, error) {
		if totp, err := s.needsTOTP(ctx, sub, amr); err != nil {
			return "", err
		} else if totp {
			st.Pending, st.Identifier = &pendingLogin{Sub: sub, AuthTime: authTime.Unix(), AMR: amr, TOTP: true}, ""
			return next(nextTOTP, "两步验证 is on: send totp or recovery_code")
		}
		needs, err := s.q.NeedsPhone(ctx, sub)
		if err != nil {
			return "", err
		}
		if needs {
			st.Pending, st.Identifier = &pendingLogin{Sub: sub, AuthTime: authTime.Unix(), AMR: amr}, ""
			return next(nextPhone, "a phone number must be bound: send a code to one")
		}
		if terms.TermsVersion != "" {
			if err := s.q.RecordConsent(ctx, sqlc.RecordConsentParams{UserID: sub, Version: version, ClientID: c.ID}); err != nil {
				return "", err
			}
		}
		// Spent before the code exists: one auth_session, one code.
		if token != "" {
			if err := s.q.DeleteChallengeSession(ctx, hash(token)); err != nil {
				return "", err
			}
		}
		sess, err := s.q.CreateSession(ctx, sqlc.CreateSessionParams{
			ClientID: c.ID, UserID: sub, AuthTime: pgtype.Timestamptz{Time: authTime, Valid: true}, Amr: amr,
		})
		if errors.Is(err, pgx.ErrNoRows) { // disabled since authenticating
			return "", &challengeError{status: http.StatusBadRequest, Code: string(goidc.ErrorCodeAccessDenied), Description: identity.ErrDisabled.Error()}
		} else if err != nil {
			return "", err
		}
		return s.op.IssueAuthCode(ctx, c, sub, st.Params, map[string]any{
			oidcstore.SessionKey: sess.ID, storeAuthTime: authTime.Unix(), storeAMR: amr,
		})
	}
	// mistake reports what the User got wrong; the auth_session, if any,
	// stays usable.
	mistake := func(err error) (string, error) {
		var bad identity.Invalid
		if !errors.As(err, &bad) {
			return "", err
		}
		return "", &challengeError{status: http.StatusBadRequest, Code: string(goidc.ErrorCodeInvalidRequest), Description: bad.Error(), AuthSession: token}
	}

	switch {
	case st.Pending != nil && st.Pending.TOTP: // nothing else before TOTP
		p := st.Pending
		totp, recoveryCode := r.PostFormValue("totp"), r.PostFormValue("recovery_code")
		if totp == "" && recoveryCode == "" {
			return mistake(identity.Invalid("两步验证 is on: send totp or recovery_code"))
		}
		err := s.twoFactor.Check(ctx, clientIP(r), p.Sub, totp, recoveryCode)
		switch {
		case err == nil:
			return signedIn(p.Sub, time.Unix(p.AuthTime, 0), withMFA(p.AMR))
		case errors.Is(err, twofactor.ErrOff): // turned off meanwhile: nothing to enter
			return signedIn(p.Sub, time.Unix(p.AuthTime, 0), p.AMR)
		case wrongSecondFactor(err):
			if p.Failures++; p.Failures >= totpTries {
				if err := s.q.DeleteChallengeSession(ctx, hash(token)); err != nil {
					return "", err
				}
				return "", &challengeError{status: http.StatusBadRequest, Code: errInvalidSession, Description: "too many wrong codes: sign in again"}
			}
			if err := save(); err != nil {
				return "", err
			}
		}
		return mistake(err)

	case r.PostFormValue("code") != "":
		if st.Identifier == "" {
			return "", invalid("no code was sent in this auth_session")
		}
		if err := s.ids.FromIP(ctx, clientIP(r), func() error { return s.codes.Check(ctx, st.Identifier, r.PostFormValue("code")) }); err != nil {
			return mistake(err)
		}
		kind, value, _ := identity.ParseIdentifier(st.Identifier)
		if p := st.Pending; p != nil {
			if err := s.ids.AddIdentifier(ctx, p.Sub, kind, value); err != nil {
				return mistake(err)
			}
			return signedIn(p.Sub, time.Unix(p.AuthTime, 0), p.AMR)
		}
		sub, err := s.ids.SignIn(ctx, kind, value)
		if err != nil {
			return mistake(err)
		}
		return signedIn(sub, time.Now(), []string{string(codeAMR(kind))})

	case r.PostFormValue("identifier") != "":
		kind, value, err := identity.ParseIdentifier(r.PostFormValue("identifier"))
		if err == nil && st.Pending != nil && kind != "phone" {
			err = identity.ErrPhone
		}
		if err == nil {
			err = s.pow.Verify(ctx, r.PostFormValue("altcha"))
		}
		if err == nil {
			err = s.codes.Send(ctx, kind, value, clientIP(r))
		}
		if err != nil {
			return mistake(err)
		}
		st.Identifier = value
		return next(nextCode, "code sent: enter it")

	case r.PostFormValue("username") != "":
		if st.Pending != nil {
			return "", invalid("a phone number must be bound")
		}
		if err := s.pow.Verify(ctx, r.PostFormValue("altcha")); err != nil {
			return mistake(err)
		}
		var sub string
		if err := s.ids.FromIP(ctx, clientIP(r), func() (err error) {
			sub, err = s.ids.CheckPassword(ctx, r.PostFormValue("username"), r.PostFormValue("password"))
			return err
		}); err != nil {
			return mistake(err)
		}
		return signedIn(sub, time.Now(), []string{string(goidc.AMRPassword)})
	}
	return "", invalid("send identifier, code, or username and password")
}

// terms tells Apps what their consent checkbox links to and which version
// to send.
func (s *Service) terms(w http.ResponseWriter, r *http.Request) {
	t, err := s.q.Terms(r.Context())
	if err != nil {
		slog.Error("terms", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"terms_url": t.TermsUrl, "privacy_url": t.PrivacyUrl, "version": t.TermsVersion})
}

func invalid(description string) error {
	return &challengeError{status: http.StatusBadRequest, Code: string(goidc.ErrorCodeInvalidRequest), Description: description}
}

// newAuthSession makes an auth_session value: 256 random bits, as the draft
// recommends.
func newAuthSession() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
