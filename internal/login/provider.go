package login

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	providers "github.com/zibyn/stars-auth/internal/provider"
)

// providerCallback is where a Provider sends the browser back to, by GET or
// (Apple's form_post) a cross-site POST. It finds the login by its state,
// signs the User in or up, and sends the browser back to the OIDC
// authorization the login was for, which goes on as after any first factor.
func (s *Service) providerCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := r.ParseForm(); err != nil {
		page(w, http.StatusBadRequest, "message", "请求无效")
		return
	}
	id := r.PathValue("id")
	authnSession, sub, err := s.providers.Finish(ctx, s.issuer, id, r.Form)
	var invalid identity.Invalid
	switch {
	case errors.As(err, &invalid):
		page(w, http.StatusForbidden, "message", invalid.Error())
		return
	case errors.Is(err, providers.ErrLogin), errors.Is(err, providers.ErrNotFound):
		slog.Info("provider login", "provider", id, "err", err)
		page(w, http.StatusBadRequest, "message", "外部登录没有完成,请返回应用重新登录")
		return
	case err != nil:
		slog.Error("provider login", "provider", id, "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	}
	as, err := s.store.Session(ctx, authnSession)
	if errors.Is(err, goidc.ErrNotFound) {
		page(w, http.StatusBadRequest, "message", "登录已过期,请返回应用重新登录")
		return
	} else if err != nil {
		slog.Error("provider login", "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	}
	as.Store = map[string]any{storeFederated: sub}
	if err := s.store.SaveSession(ctx, as); err != nil {
		slog.Error("provider login", "err", err)
		page(w, http.StatusInternalServerError, "message", "出错了,请稍后重试")
		return
	}
	http.Redirect(w, r, "/authorize/"+as.ID, http.StatusSeeOther)
}
