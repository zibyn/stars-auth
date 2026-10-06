// Command conformance runs the OP that the OpenID conformance suite tests in
// CI (see run.sh). Login and consent pages are test fixtures, not product UI.
package main

import (
	"cmp"
	"crypto/tls"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zibyn/stars-auth/internal/oidc/conformance/authutil"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
	"github.com/zibyn/stars-auth/internal/oidc/provider"
)

func main() {
	op, err := provider.New(
		provider.Config{
			Issuer:      authutil.Issuer,
			JWKS:        authutil.PrivateJWKSFunc(),
			IDTokenAlgs: []goidc.SignatureAlgorithm{goidc.SigAlgRS256, goidc.SigAlgNone},
		},
		provider.WithScopes(authutil.Scopes...),
		provider.WithUserInfoSignatureAlgs(goidc.SigAlgRS256, goidc.SigAlgNone),
		provider.WithSecretBasicAuthn(),
		provider.WithSecretPostAuthn(),
		provider.WithPrivateKeyJWTAuthn(goidc.SigAlgRS256),
		provider.WithAuthCodeGrant(
			provider.AuthCodeGrantConfig{
				ResponseTypes: []goidc.ResponseType{
					goidc.ResponseTypeCode,
					goidc.ResponseTypeIDToken,
					goidc.ResponseTypeToken,
					goidc.ResponseTypeCodeAndIDToken,
					goidc.ResponseTypeCodeAndToken,
					goidc.ResponseTypeIDTokenAndToken,
					goidc.ResponseTypeCodeAndIDTokenAndToken,
				},
			},
			provider.WithPAR(nil),
			provider.WithJAR(
				[]goidc.SignatureAlgorithm{goidc.SigAlgRS256, goidc.SigAlgNone},
				provider.WithJARByReference(nil),
				provider.WithJARByReferenceUnregisteredURIs(),
			),
			provider.WithJARM([]goidc.SignatureAlgorithm{goidc.SigAlgRS256}),
			provider.WithIssuerResponseParameter(),
			provider.WithClaimsParameter(),
			provider.WithPKCE([]goidc.CodeChallengeMethod{goidc.CodeChallengeMethodSHA256}),
			provider.WithFormPostResponseMode(),
			provider.WithAuthPolicies(authutil.Policy()),
		),
		provider.WithRefreshTokenGrant(nil),
		provider.WithClaims(authutil.Claims...),
		provider.WithACRs(authutil.ACRs...),
		provider.WithStaticClients(clients()...),
		provider.WithTokenOptions(authutil.TokenOptionsFunc(goidc.SigAlgRS256)),
		provider.WithIDTokenClaims(authutil.IDTokenClaimsFunc()),
		provider.WithUserInfoClaims(authutil.UserInfoClaimsFunc()),
		provider.WithHTTPClientFunc(authutil.HTTPClient),
		provider.WithErrorHandler(authutil.HandleError),
		provider.WithErrorRenderer(authutil.RenderError()),
		provider.WithDisplayValues(authutil.DisplayValues...),
		provider.WithSubjectIdentifiers(
			[]goidc.SubIdentifierType{goidc.SubIdentifierPublic, goidc.SubIdentifierPairwise},
			provider.WithPairwiseSubjectFunc(authutil.PairwiseSubjectFunc()),
		),
		provider.WithLogout(provider.LogoutConfig{
			HandleFunc: authutil.HandleLogout(),
		}, provider.WithLogoutPolicies(authutil.LogoutPolicy())),
	)
	if err != nil {
		log.Fatal(err)
	}

	// Set up the server.
	mux := http.NewServeMux()
	handler := op.Handler()

	hostURL, _ := url.Parse(authutil.Issuer)
	mux.Handle(hostURL.Hostname()+"/", handler)

	server := &http.Server{
		Addr:              ":" + cmp.Or(hostURL.Port(), "443"),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{authutil.ServerCert()},
			MinVersion:   tls.VersionTLS12,
		},
	}
	if err := server.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// clients are the static clients config.json names: the suite needs two
// client_secret_basic clients and one client_secret_post client.
func clients() []*goidc.Client {
	const cb = "https://localhost.emobix.co.uk:8443/test/a/goidc/"
	scopes := make([]string, len(authutil.Scopes))
	for i, s := range authutil.Scopes {
		scopes[i] = s.ID
	}
	c := func(id string, m goidc.AuthnMethod) *goidc.Client {
		return &goidc.Client{
			ID:     id,
			// 32+ bytes: the suite derives HS256 keys from it.
			Secret: id + "_secret_0123456789abcdefghijklmnopqrstuvwxyz",
			ClientMeta: goidc.ClientMeta{
				TokenAuthnMethod:       m,
				ScopeIDs:               strings.Join(scopes, " "),
				GrantTypes:             []goidc.GrantType{goidc.GrantAuthorizationCode, goidc.GrantRefreshToken},
				ResponseTypes:          []goidc.ResponseType{goidc.ResponseTypeCode},
				RedirectURIs:           []string{cb + "callback"},
				PostLogoutRedirectURIs: []string{cb + "post_logout_redirect"},
			},
		}
	}
	return []*goidc.Client{
		c("client_one", goidc.AuthnMethodSecretBasic),
		c("client_two", goidc.AuthnMethodSecretBasic),
		c("client_three", goidc.AuthnMethodSecretPost),
	}
}
