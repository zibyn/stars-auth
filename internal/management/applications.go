package management

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidcstore"
)

// ApplicationSettings are what an admin edits on an Application.
type ApplicationSettings struct {
	Name                   string       `json:"name" minLength:"1" maxLength:"64"`
	RedirectURIs           []string     `json:"redirectUris" nullable:"false"`
	PostLogoutRedirectURIs []string     `json:"postLogoutRedirectUris" nullable:"false"`
	DefaultAPI             string       `json:"defaultApi,omitempty" doc:"Identifier of the API its access tokens are for; empty for none"`
	SessionIdleTimeout     int32        `json:"sessionIdleTimeout,omitempty" minimum:"0" maximum:"31536000" doc:"Seconds a Session may sit idle; 0 for the default (30 days browser, 90 days App)"`
	RefreshTokens          bool         `json:"refreshTokens"`
	WebhookURL             string       `json:"webhookUrl,omitempty" doc:"Where user.deleted is sent; empty for none"`
	WebhookSecret          string       `json:"webhookSecret,omitempty" writeOnly:"true" doc:"Key the webhook is signed with; empty keeps the stored one. Never read back."`
	AppleAppIDs            []string     `json:"appleAppIds" nullable:"false" doc:"Team ID + Bundle ID, as ABCDE12345.com.example.app"`
	AndroidApps            []AndroidApp `json:"androidApps" nullable:"false"`
}

type AndroidApp struct {
	PackageName            string   `json:"packageName"`
	SHA256CertFingerprints []string `json:"sha256CertFingerprints" nullable:"false" doc:"As AB:CD:…, 32 bytes"`
}

type Application struct {
	ClientID  string    `json:"clientId"`
	Type      string    `json:"type" enum:"public,confidential" doc:"Confidential Applications authenticate with a client secret; public ones (Apps, SPAs) with PKCE only"`
	Builtin   bool      `json:"builtin" doc:"The console: read-only"`
	CreatedAt time.Time `json:"createdAt"`
	ApplicationSettings
	WebhookSecretUpdatedAt *time.Time `json:"webhookSecretUpdatedAt,omitempty" doc:"When the webhook signing key was last set"`
}

type clientIDPath struct {
	ClientID string `path:"clientId"`
}

type listApplicationsOutput struct {
	Body struct {
		Applications []Application `json:"applications" nullable:"false"`
	}
}

func (s *Service) listApplications(ctx context.Context, _ *struct{}) (*listApplicationsOutput, error) {
	apps, err := s.applications(ctx, "")
	out := &listApplicationsOutput{}
	out.Body.Applications = apps
	return out, err
}

type applicationOutput struct{ Body Application }

func (s *Service) getApplication(ctx context.Context, in *clientIDPath) (*applicationOutput, error) {
	app, err := s.application(ctx, in.ClientID)
	if err != nil {
		return nil, err
	}
	return &applicationOutput{Body: app}, nil
}

// application is one Application, or a 404.
func (s *Service) application(ctx context.Context, clientID string) (Application, error) {
	apps, err := s.applications(ctx, clientID)
	if err == nil && len(apps) == 0 {
		err = huma.Error404NotFound("no such Application")
	}
	if err != nil {
		return Application{}, err
	}
	return apps[0], nil
}

func (s *Service) applications(ctx context.Context, clientID string) ([]Application, error) {
	rows, err := s.q.ListApplications(ctx, clientID)
	if err != nil {
		return nil, err
	}
	apps := []Application{}
	for _, r := range rows {
		a := Application{
			ClientID: r.ClientID, Type: r.Type, Builtin: r.Builtin, CreatedAt: r.CreatedAt.Time,
			ApplicationSettings: ApplicationSettings{
				Name: r.Name, RedirectURIs: r.RedirectUris, PostLogoutRedirectURIs: r.PostLogoutRedirectUris,
				DefaultAPI: r.DefaultApi, SessionIdleTimeout: r.SessionIdleTimeout, RefreshTokens: r.RefreshTokens,
				WebhookURL: r.WebhookUrl, AppleAppIDs: r.AppleAppIds,
			},
		}
		if r.WebhookSecretUpdatedAt.Valid {
			a.WebhookSecretUpdatedAt = &r.WebhookSecretUpdatedAt.Time
		}
		if err := json.Unmarshal(r.AndroidApps, &a.AndroidApps); err != nil {
			return nil, err
		}
		apps = append(apps, a)
	}
	return apps, nil
}

type createApplicationInput struct {
	Body struct {
		Type     string              `json:"type" enum:"public,confidential"`
		Settings ApplicationSettings `json:"settings"`
	}
}

type createApplicationOutput struct {
	Body struct {
		Application Application `json:"application"`
		Secret      string      `json:"secret,omitempty" doc:"The client secret of a confidential Application; shown this once"`
	}
}

func (s *Service) createApplication(ctx context.Context, in *createApplicationInput) (*createApplicationOutput, error) {
	out := &createApplicationOutput{}
	clientID := rand.Text()
	var secretHash []byte
	if in.Body.Type == "confidential" {
		out.Body.Secret = rand.Text()
		secretHash = oidcstore.SecretHash(out.Body.Secret)
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.InsertApplication(ctx, sqlc.InsertApplicationParams{ClientID: clientID, Type: in.Body.Type, SecretHash: secretHash}); err != nil {
			return err
		}
		_, err := s.saveSettings(ctx, q, clientID, &in.Body.Settings)
		return err
	})
	if err != nil {
		return nil, err
	}
	out.Body.Application, err = s.application(ctx, clientID)
	return out, err
}

func (s *Service) updateApplication(ctx context.Context, in *struct {
	ClientID string `path:"clientId"`
	Body     ApplicationSettings
}) (*struct{}, error) {
	n, err := s.saveSettings(ctx, s.q, in.ClientID, &in.Body)
	if err != nil || n > 0 {
		return nil, err
	}
	return nil, s.notBuiltin(ctx, in.ClientID)
}

// notBuiltin explains why an Application was left alone: 404 or 409.
func (s *Service) notBuiltin(ctx context.Context, clientID string) error {
	app, err := s.application(ctx, clientID)
	if err == nil && app.Builtin {
		err = huma.Error409Conflict("内置 Application 不能修改或删除")
	}
	return err
}

var (
	appleAppID  = regexp.MustCompile(`^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$`)
	packageName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`)
	certSHA256  = regexp.MustCompile(`^([0-9A-F]{2}:){31}[0-9A-F]{2}$`)
)

func (st *ApplicationSettings) validate() error {
	// Its tokens would let the Application act as any admin who signs in to it.
	if st.DefaultAPI == identity.ManagementAPI {
		return identity.Invalid("Management API 只供管理端使用")
	}
	for _, u := range append(append([]string{}, st.RedirectURIs...), st.PostLogoutRedirectURIs...) {
		if p, err := url.Parse(u); err != nil || !p.IsAbs() || p.Fragment != "" || len(u) > 2048 {
			return identity.Invalid("回调地址须为完整 URI,不带 #:" + u)
		}
	}
	if st.WebhookURL != "" {
		if p, err := url.Parse(st.WebhookURL); err != nil || (p.Scheme != "https" && p.Scheme != "http") || p.Host == "" {
			return identity.Invalid("webhook URL 须为 http(s) 地址")
		}
	}
	for _, id := range st.AppleAppIDs {
		if !appleAppID.MatchString(id) {
			return identity.Invalid("Apple App ID 须为 Team ID.Bundle ID:" + id)
		}
	}
	for _, a := range st.AndroidApps {
		if !packageName.MatchString(a.PackageName) {
			return identity.Invalid("Android 包名不对:" + a.PackageName)
		}
		for _, f := range a.SHA256CertFingerprints {
			if !certSHA256.MatchString(f) {
				return identity.Invalid("签名指纹须为 SHA-256,如 AB:CD:…:" + f)
			}
		}
	}
	return nil
}

// saveSettings writes an Application's settings; 0 rows for a built-in or
// missing one.
func (s *Service) saveSettings(ctx context.Context, q *sqlc.Queries, clientID string, st *ApplicationSettings) (int64, error) {
	if err := invalid(st.validate()); err != nil {
		return 0, err
	}
	var secret []byte
	if st.WebhookSecret != "" {
		var err error
		if secret, err = s.keyring.Seal([]byte(st.WebhookSecret), []byte("application:"+clientID+":webhook")); err != nil {
			return 0, err
		}
	}
	android, err := json.Marshal(append([]AndroidApp{}, st.AndroidApps...))
	if err != nil {
		return 0, err
	}
	n, err := q.UpdateApplication(ctx, sqlc.UpdateApplicationParams{
		ClientID: clientID, Name: st.Name,
		RedirectUris:           append([]string{}, st.RedirectURIs...),
		PostLogoutRedirectUris: append([]string{}, st.PostLogoutRedirectURIs...),
		DefaultApi:             st.DefaultAPI, IdleSecs: st.SessionIdleTimeout, RefreshTokens: st.RefreshTokens,
		WebhookUrl: st.WebhookURL, WebhookSecret: secret,
		AppleAppIds: append([]string{}, st.AppleAppIDs...), AndroidApps: android,
	})
	var pg *pgconn.PgError
	switch {
	case isFKViolation(err):
		return 0, huma.Error422UnprocessableEntity("没有这个 API")
	case errors.As(err, &pg) && pg.ConstraintName == "applications_webhook_check":
		return 0, huma.Error422UnprocessableEntity("webhook 需要签名密钥")
	}
	return n, err
}

func (s *Service) deleteApplication(ctx context.Context, in *clientIDPath) (*struct{}, error) {
	if err := s.notBuiltin(ctx, in.ClientID); err != nil {
		return nil, err
	}
	return nil, s.q.DeleteApplication(ctx, in.ClientID)
}

type newSecretOutput struct {
	Body struct {
		Secret string `json:"secret" doc:"The new client secret; shown this once. The old one stops working."`
	}
}

func (s *Service) newSecret(ctx context.Context, in *clientIDPath) (*newSecretOutput, error) {
	out := &newSecretOutput{}
	out.Body.Secret = rand.Text()
	n, err := s.q.SetApplicationSecret(ctx, sqlc.SetApplicationSecretParams{ClientID: in.ClientID, SecretHash: oidcstore.SecretHash(out.Body.Secret)})
	if err != nil || n > 0 {
		return out, err
	}
	if err := s.notBuiltin(ctx, in.ClientID); err != nil {
		return nil, err
	}
	return nil, huma.Error409Conflict("public Application 没有 client secret")
}
