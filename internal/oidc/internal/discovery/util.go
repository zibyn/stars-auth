package discovery

import (
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/oidc/internal/oidc"
)

func NewConfiguration(ctx oidc.Context) goidc.Configuration {
	scopes := make([]string, len(ctx.Scopes))
	for i, scope := range ctx.Scopes {
		scopes[i] = scope.ID
	}

	config := goidc.Configuration{
		Issuer:                     ctx.Issuer(),
		AuthorizationEndpoint:      ctx.BaseURL() + ctx.AuthorizationEndpoint,
		UserInfoEndpoint:           ctx.BaseURL() + ctx.UserInfoEndpoint,
		TokenEndpoint:              ctx.BaseURL() + ctx.TokenEndpoint,
		JWKSEndpoint:               ctx.BaseURL() + ctx.JWKSEndpoint,
		ResponseTypes:              ctx.ResponseTypes,
		ResponseModes:              ctx.ResponseModes,
		GrantTypes:                 ctx.GrantTypes,
		UserClaimsSupported:        ctx.Claims,
		ClaimTypesSupported:        ctx.ClaimTypes,
		SubIdentifierTypes:         ctx.SubIdentifierTypes,
		IDTokenSigAlgs:             ctx.IDTokenSigAlgs,
		UserInfoSigAlgs:            ctx.UserInfoSigAlgs,
		Scopes:                     scopes,
		TokenAuthnMethods:          ctx.AuthnMethods,
		TokenAuthnSigAlgs:          ctx.TokenAuthnSigAlgs(),
		IssuerResponseParamEnabled: ctx.IssuerRespParamEnabled,
		ClaimsParamEnabled:         ctx.ClaimsParamEnabled,
		AuthDetailsEnabled:         ctx.RAREnabled,
		AuthDetailTypesSupported:   ctx.RARDetailTypes,
		ACRs:                       ctx.ACRs,
		DisplayValues:              ctx.DisplayValues,
	}

	if ctx.PAREnabled {
		config.PARRequired = ctx.PARRequired
		config.PAREndpoint = ctx.BaseURL() + ctx.PAREndpoint
	}

	if ctx.JAREnabled {
		config.JAREnabled = ctx.JAREnabled
		config.JARRequired = ctx.JARRequired
		config.JARAlgs = ctx.JARSigAlgs
		if ctx.JARByReferenceEnabled {
			config.JARByReferenceEnabled = ctx.JARByReferenceEnabled
			config.JARRequestURIRegistrationRequired = !ctx.JARByReferenceUnregisteredURIEnabled
		}
		if ctx.JAREncEnabled {
			config.JARKeyEncAlgs = ctx.JARKeyEncAlgs
			config.JARContentEncAlgs = ctx.JARContentEncAlgs
		}
	}

	if ctx.JARMEnabled {
		config.JARMAlgs = ctx.JARMSigAlgs
		if ctx.JARMEncEnabled {
			config.JARMKeyEncAlgs = ctx.JARMKeyEncAlgs
			config.JARMContentEncAlgs = ctx.JARMContentEncAlgs
		}
	}

	if ctx.DPoPEnabled {
		config.DPoPSigAlgs = ctx.DPoPSigAlgs
	}

	if ctx.TokenIntrospectionEnabled {
		config.TokenIntrospectionEndpoint = ctx.BaseURL() + ctx.TokenIntrospectionEndpoint
		config.TokenIntrospectionAuthnMethods = ctx.AuthnMethods
		config.TokenIntrospectionAuthnSigAlgs = ctx.TokenAuthnSigAlgs()
	}

	if ctx.TokenRevocationEnabled {
		config.TokenRevocationEndpoint = ctx.BaseURL() + ctx.TokenRevocationEndpoint
		config.TokenRevocationAuthnMethods = ctx.AuthnMethods
		config.TokenRevocationAuthnSigAlgs = ctx.TokenAuthnSigAlgs()
	}

	if ctx.MTLSEnabled {
		config.TLSBoundTokensEnabled = ctx.MTLSTokenBindingEnabled

		config.MTLSAliases = &struct {
			TokenEndpoint              string `json:"token_endpoint"`
			ParEndpoint                string `json:"pushed_authorization_request_endpoint,omitempty"`
			UserInfoEndpoint           string `json:"userinfo_endpoint"`
			TokenIntrospectionEndpoint string `json:"introspection_endpoint,omitempty"`
			TokenRevocationEndpoint    string `json:"revocation_endpoint,omitempty"`
		}{
			TokenEndpoint:    ctx.MTLSBaseURL() + ctx.TokenEndpoint,
			UserInfoEndpoint: ctx.MTLSBaseURL() + ctx.UserInfoEndpoint,
		}

		if ctx.PAREnabled {
			config.MTLSAliases.ParEndpoint = ctx.MTLSBaseURL() + ctx.PAREndpoint
		}

		if ctx.TokenIntrospectionEnabled {
			config.MTLSAliases.TokenIntrospectionEndpoint = ctx.MTLSBaseURL() + ctx.TokenIntrospectionEndpoint
		}

		if ctx.TokenRevocationEnabled {
			config.MTLSAliases.TokenRevocationEndpoint = ctx.MTLSBaseURL() + ctx.TokenRevocationEndpoint
		}

	}

	if ctx.UserInfoEncEnabled {
		config.UserInfoKeyEncAlgs = ctx.UserInfoKeyEncAlgs
		config.UserInfoContentEncAlgs = ctx.UserInfoContentEncAlgs
	}

	if ctx.IDTokenEncEnabled {
		config.IDTokenKeyEncAlgs = ctx.IDTokenKeyEncAlgs
		config.IDTokenContentEncAlgs = ctx.IDTokenContentEncAlgs
	}

	if ctx.PKCEEnabled {
		config.CodeChallengeMethods = ctx.PKCEChallengeMethods
	}

	if ctx.LogoutEnabled {
		config.EndSessionEndpoint = ctx.BaseURL() + ctx.LogoutEndpoint
	}

	return config
}
