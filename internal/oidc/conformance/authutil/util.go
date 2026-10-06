// Package authutil contains utilities to set up example authorization server
// using goidc.
package authutil

import (
	"cmp"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/zibyn/stars-auth/internal/oidc/conformance/keys"
	"github.com/zibyn/stars-auth/internal/oidc/conformance/ui"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
)

// Issuer is overridable so the harness can run where port 443 is not bindable.
var Issuer = cmp.Or(os.Getenv("ISSUER"), "https://auth.localhost")

const (
	headerXFAPIInteractionID = "X-Fapi-Interaction-Id"
)

var (
	Scopes = []goidc.Scope{
		goidc.ScopeOpenID, goidc.ScopeOfflineAccess, goidc.ScopeProfile,
		goidc.ScopeEmail, goidc.ScopeAddress, goidc.ScopePhone,
	}
	Claims = []string{
		goidc.ClaimEmail, goidc.ClaimEmailVerified, goidc.ClaimPhoneNumber,
		goidc.ClaimPhoneNumberVerified, goidc.ClaimAddress,
	}
	ACRs          = []goidc.ACR{goidc.ACRMaceIncommonIAPBronze, goidc.ACRMaceIncommonIAPSilver}
	DisplayValues = []goidc.DisplayValue{goidc.DisplayValuePage, goidc.DisplayValuePopup}
)

var (
	errLogoutCancelled error = errors.New("logout cancelled by the user")
)

func ClientPrivateKeyJWT(id string) (*goidc.Client, goidc.JSONWebKeySet) {
	client, jwks := Client(id)
	client.TokenAuthnMethod = goidc.AuthnMethodPrivateKeyJWT
	return client, jwks
}

func ClientSecretPost(id, secret string, scopes ...goidc.Scope) *goidc.Client {
	client, _ := Client(id, scopes...)
	client.TokenAuthnMethod = goidc.AuthnMethodSecretPost
	client.Secret = secret
	return client
}

func Client(id string, scopes ...goidc.Scope) (*goidc.Client, goidc.JSONWebKeySet) {
	// Extract the public client JWKS.
	jwks := privateJWKS(id)

	// Extract scopes IDs.
	scopes = append(scopes, Scopes...)
	scopesIDs := make([]string, len(scopes))
	for i, scope := range scopes {
		scopesIDs[i] = scope.ID
	}

	publicJWKS := jwks.Public()
	return &goidc.Client{
		ID: id,
		ClientMeta: goidc.ClientMeta{
			ScopeIDs: strings.Join(scopesIDs, " "),
			JWKS:     &publicJWKS,
			GrantTypes: []goidc.GrantType{
				goidc.GrantAuthorizationCode,
				goidc.GrantRefreshToken,
				goidc.GrantImplicit,
				goidc.GrantClientCredentials,
			},
			ResponseTypes: []goidc.ResponseType{
				goidc.ResponseTypeCode,
				goidc.ResponseTypeCodeAndIDToken,
			},
			RedirectURIs: []string{
				"https://localhost/callback",
				"https://localhost.emobix.co.uk:8443/test/a/goidc/callback",
				"https://localhost.emobix.co.uk:8443/test/a/goidc/callback?dummy1=lorem&dummy2=ipsum",
			},
		},
	}, jwks
}

func PrivateJWKSFunc() goidc.JWKSFunc {
	jwksBytes, err := keys.FS.ReadFile("server.jwks")
	if err != nil {
		log.Fatal(err)
	}

	var jwks goidc.JSONWebKeySet
	if err := json.Unmarshal(jwksBytes, &jwks); err != nil {
		log.Fatal(err)
	}

	return func(ctx context.Context) (goidc.JSONWebKeySet, error) {
		return jwks, nil
	}
}

func privateJWKS(clientID string) goidc.JSONWebKeySet {
	jwksBytes, err := keys.FS.ReadFile(clientID + ".jwks")
	if err != nil {
		log.Fatal(err)
	}

	var jwks goidc.JSONWebKeySet
	if err := json.Unmarshal(jwksBytes, &jwks); err != nil {
		log.Fatal(err)
	}

	return jwks
}

func ServerCert() tls.Certificate {
	certBytes, err := keys.FS.ReadFile("server.crt")
	if err != nil {
		log.Fatal(err)
	}

	keyBytes, err := keys.FS.ReadFile("server.key")
	if err != nil {
		log.Fatal(err)
	}

	tlsCert, err := tls.X509KeyPair(certBytes, keyBytes)
	if err != nil {
		log.Fatal(err)
	}

	return tlsCert
}

func TokenOptionsFunc(alg goidc.SignatureAlgorithm) goidc.TokenOptionsFunc {
	return func(_ context.Context, _ *goidc.Grant, _ *goidc.Client) goidc.TokenOptions {
		opts := goidc.NewJWTTokenOptions(alg, 600)
		return opts
	}
}

func IDTokenClaimsFunc() goidc.IDTokenClaimsFunc {
	return func(_ context.Context, grant *goidc.Grant) map[string]any {
		claims, _ := grant.Store[paramIDTokenClaims].(map[string]any)
		return claims
	}
}

func UserInfoClaimsFunc() goidc.UserInfoClaimsFunc {
	return func(_ context.Context, grant *goidc.Grant) map[string]any {
		claims, _ := grant.Store[paramUserInfoClaims].(map[string]any)
		return claims
	}
}

func HTTPClient(_ context.Context) *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
	}
}

func HandleError(ctx context.Context, err error) {
	log.Printf("error: %s\n", err.Error())
}

func RenderError() goidc.RenderErrorFunc {
	tmpl := template.Must(template.ParseFS(ui.FS, "template.html"))
	return func(w http.ResponseWriter, r *http.Request, err error) error {
		w.WriteHeader(http.StatusOK)
		_ = tmpl.ExecuteTemplate(w, "error", authnPage{
			Error: err.Error(),
		})
		return nil
	}

}

func PairwiseSubjectFunc() goidc.PairwiseSubjectFunc {
	return func(_ context.Context, sub string, _ *goidc.Client) string {
		return sub
	}
}

func ConsumeJTIFunc() goidc.ConsumeJTIFunc {
	jtiStore := make(map[string]struct{})
	return func(ctx context.Context, jti string) error {
		if _, ok := jtiStore[jti]; ok {
			return errors.New("jti already used")
		}

		jtiStore[jti] = struct{}{}
		return nil
	}
}

func FAPIIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		interactionID := r.Header.Get(headerXFAPIInteractionID)

		// Verify if the interaction ID is valid, generate a new value if not.
		if _, err := uuid.Parse(interactionID); err != nil {
			interactionID = uuid.NewString()
		}

		// Return the same interaction ID in the response or a new valid value
		// if the original is invalid.
		w.Header().Add(headerXFAPIInteractionID, interactionID)

		next.ServeHTTP(w, r)
	})
}

type LogoutPage struct {
	BaseURL     string
	CallbackID  string
	IsLoggedOut bool
	Session     map[string]any
}

func LogoutPolicy() goidc.LogoutPolicy {

	tmpl := template.Must(template.ParseFS(ui.FS, "template.html"))
	return goidc.NewLogoutPolicy(
		"main",
		func(r *http.Request, ls *goidc.LogoutSession) bool {
			return true
		},
		func(w http.ResponseWriter, r *http.Request, ls *goidc.LogoutSession) (goidc.Status, error) {
			logout := r.PostFormValue("logout")
			if logout == "" {
				slog.Debug("rendering logout page")
				if err := tmpl.ExecuteTemplate(w, "logout", LogoutPage{
					BaseURL:    Issuer,
					CallbackID: ls.ID,
					Session:    mapify(ls),
				}); err != nil {
					return goidc.StatusFailure, err
				}
				return goidc.StatusPending, nil
			}

			if logout != "true" {
				slog.Debug("user cancelled logout")
				return goidc.StatusFailure, errLogoutCancelled
			}

			cookie, err := r.Cookie(cookieUserSessionID)
			if err != nil {
				slog.Debug("the session cookie was not found", "error", err)
				return goidc.StatusSuccess, nil
			}

			delete(userSessionStore, cookie.Value)
			return goidc.StatusSuccess, nil
		},
	)
}

func HandleLogout() goidc.HandleDefaultPostLogoutFunc {
	tmpl := template.Must(template.ParseFS(ui.FS, "template.html"))
	return func(w http.ResponseWriter, r *http.Request, ls *goidc.LogoutSession) error {
		if err := tmpl.ExecuteTemplate(w, "logout", LogoutPage{IsLoggedOut: true}); err != nil {
			return fmt.Errorf("could not execute logout template: %w", err)
		}
		return nil
	}
}
