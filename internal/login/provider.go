package login

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/provider"
)

// binderCookie ties a Provider login to the browser that started it.
const binderCookie = "__Host-provider-login"

// binder returns the browser's binder, giving it one if it has none; one
// per browser, so that logins in several tabs each find theirs.
func binder(w http.ResponseWriter, r *http.Request) string {
	if c, err := r.Cookie(binderCookie); err == nil && c.Value != "" {
		return c.Value
	}
	v := rand.Text()
	http.SetCookie(w, &http.Cookie{Name: binderCookie, Value: v, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	return v
}

// sameBinder reports whether the browser holds the binder stored hashed
// as want.
func sameBinder(r *http.Request, want any) bool {
	c, err := r.Cookie(binderCookie)
	w, _ := want.(string)
	return err == nil && w != "" && subtle.ConstantTimeCompare([]byte(hex.EncodeToString(hash(c.Value))), []byte(w)) == 1
}

// providerCallback is where a Provider sends the browser back to, by GET or
// (Apple's form_post) a cross-site POST, which carries no Lax cookie: a
// POST is sent on to a GET of the same, which does. It finds the redirect
// by its state, in the browser that started it, signs the User in or up,
// and sends the browser back to the OIDC authorization the login was for,
// which goes on as after any first factor.
func (s *Service) providerCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := r.ParseForm(); err != nil {
		page(w, http.StatusBadRequest, "message", "请求无效")
		return
	}
	if r.Method == http.MethodPost {
		http.Redirect(w, r, r.URL.Path+"?"+r.Form.Encode(), http.StatusSeeOther)
		return
	}
	id := r.PathValue("id")
	b, session := "", ""
	if c, err := r.Cookie(binderCookie); err == nil {
		b = c.Value
	}
	sess, err := s.session(w, r)
	if err != nil {
		slog.Error("provider login", "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	} else if sess != nil {
		session = sess.ID
	}
	f, err := s.providers.Finish(ctx, s.issuer, id, r.Form, b, session)
	if f.Account != "" {
		backToAccount(w, r, id, f.Account, err)
		return
	}
	var invalid identity.Invalid
	switch {
	case errors.As(err, &invalid):
		page(w, http.StatusForbidden, "message", invalid.Error())
		return
	case errors.Is(err, provider.ErrLogin), errors.Is(err, provider.ErrNotFound):
		slog.Info("provider login", "provider", id, "err", err)
		page(w, http.StatusBadRequest, "message", "外部登录没有完成,请返回应用重新登录")
		return
	case err != nil:
		slog.Error("provider login", "provider", id, "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	}
	as, err := s.store.Session(ctx, f.AuthnSession)
	if errors.Is(err, goidc.ErrNotFound) {
		page(w, http.StatusBadRequest, "message", "登录已过期,请返回应用重新登录")
		return
	} else if err != nil {
		slog.Error("provider login", "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	}
	as.Store = map[string]any{storeFederated: f.Sub, storeBinder: hex.EncodeToString(hash(b))}
	if err := s.store.SaveSession(ctx, as); err != nil {
		slog.Error("provider login", "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	}
	http.Redirect(w, r, "/authorize/"+as.ID, http.StatusSeeOther)
}

// backToAccount sends the browser back to the account center after a
// redirect it started: ?bound=<id> or ?reauthenticated=<id>, or ?error=
// to show the User.
func backToAccount(w http.ResponseWriter, r *http.Request, id, done string, err error) {
	q := url.Values{done: {id}}
	var invalid identity.Invalid
	switch {
	case errors.As(err, &invalid):
		q = url.Values{"error": {invalid.Error()}}
	case errors.Is(err, provider.ErrLogin), errors.Is(err, provider.ErrNotFound):
		slog.Info("provider redirect from the account center", "provider", id, "err", err)
		q = url.Values{"error": {"没有完成,请重试"}}
	case err != nil:
		slog.Error("provider redirect from the account center", "provider", id, "err", err)
		q = url.Values{"error": {"出错了,请稍后重试"}}
	}
	http.Redirect(w, r, "/account?"+q.Encode(), http.StatusSeeOther)
}
