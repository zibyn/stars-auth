package authorize

import (
	"errors"
	"fmt"

	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/oidc/internal/client"
	"github.com/zibyn/stars-auth/internal/oidc/internal/dpop"
	"github.com/zibyn/stars-auth/internal/oidc/internal/hashutil"
	"github.com/zibyn/stars-auth/internal/oidc/internal/oidc"
	"github.com/zibyn/stars-auth/internal/oidc/internal/timeutil"
)

func pushAuth(ctx oidc.Context, req request) (parResponse, error) {
	c, err := client.Authenticated(ctx, client.AuthnContextPAR)
	if err != nil {
		return parResponse{}, err
	}

	as, err := func() (*goidc.AuthnSession, error) {
		jar := ctx.JAREnabled && (ctx.JARRequired || c.JARRequired || req.RequestObject != "")
		if jar {
			if req.RequestObject == "" {
				return nil, goidc.WrapError(goidc.ErrorCodeInvalidRequest, "invalid request", errors.New("request object is required"))
			}

			jar, err := jarFromRequestObject(ctx, req.RequestObject, c)
			if err != nil {
				return nil, err
			}

			if err := validatePushedRequestWithJAR(ctx, req, jar, c); err != nil {
				return nil, err
			}

			return &goidc.AuthnSession{
				ID:                      ctx.AuthnSessionID(),
				Status:                  goidc.StatusPending,
				PushedAuthReqID:         ctx.PARID(),
				ClientID:                c.ID,
				AuthorizationParameters: jar.AuthorizationParameters,
				CreatedAt:               timeutil.TimestampNow(),
				ExpiresAt:               timeutil.TimestampNow() + ctx.PARLifetimeSecs,
				JWKThumbprint:           dpopThumbprintForPAR(ctx, req),
				ClientCertThumbprint:    tlsThumbprint(ctx),
				Store:                   make(map[string]any),
			}, nil
		}

		if err := validateSimplePushedRequest(ctx, req, c); err != nil {
			return nil, err
		}

		return &goidc.AuthnSession{
			ID:                      ctx.AuthnSessionID(),
			Status:                  goidc.StatusPending,
			PushedAuthReqID:         ctx.PARID(),
			ClientID:                c.ID,
			AuthorizationParameters: req.AuthorizationParameters,
			CreatedAt:               timeutil.TimestampNow(),
			ExpiresAt:               timeutil.TimestampNow() + ctx.PARLifetimeSecs,
			JWKThumbprint:           dpopThumbprintForPAR(ctx, req),
			ClientCertThumbprint:    tlsThumbprint(ctx),
			Store:                   make(map[string]any),
		}, nil
	}()
	if err != nil {
		return parResponse{}, err
	}

	if err := ctx.PARHandleSession(as, c); err != nil {
		var oidcErr goidc.Error
		if errors.As(err, &oidcErr) {
			return parResponse{}, oidcErr
		}
		return parResponse{}, fmt.Errorf("could not handle the pushed authorization request session: %w", err)
	}

	if err := ctx.AuthSaveSession(as); err != nil {
		return parResponse{}, fmt.Errorf("could not save the pushed authorization request session: %w", err)
	}

	return parResponse{
		RequestURI: parRequestURIPrefix + as.PushedAuthReqID,
		ExpiresIn:  ctx.PARLifetimeSecs,
	}, nil
}

// dpopThumbprintForPAR extracts the DPoP JWK thumbprint from the request.
// The DPoP proof is expected to have been validated before this point.
func dpopThumbprintForPAR(ctx oidc.Context, req request) string {
	if !ctx.DPoPEnabled {
		return ""
	}
	if dpopJWT, ok := dpop.JWT(ctx); ok {
		return dpop.JWKThumbprint(dpopJWT, ctx.DPoPSigAlgs)
	}
	return req.DPoPJKT
}

func tlsThumbprint(ctx oidc.Context) string {
	if !ctx.MTLSTokenBindingEnabled {
		return ""
	}
	clientCert, err := ctx.ClientCert()
	if err != nil {
		return ""
	}
	return hashutil.Thumbprint(string(clientCert.Raw))
}
