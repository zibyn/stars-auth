package management_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidcstore"
)

type application struct {
	ClientID               string
	Name                   string
	Type                   string
	Builtin                bool
	RedirectURIs           []string
	DefaultAPI             string
	SessionIdleTimeout     int
	RefreshTokens          bool
	WebhookURL             string
	WebhookSecretUpdatedAt *time.Time
	AppleAppIDs            []string
	AndroidApps            []struct {
		PackageName            string
		SHA256CertFingerprints []string
	}
}

const fingerprint = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"

func TestManageApplications(t *testing.T) {
	e := start(t)
	e.user("RO", []string{"readonly"})
	owner, ro := e.token(e.owner, nil), e.token("RO", nil)
	e.call("PUT", owner, apiPath(track), map[string]any{"name": "Track"}, nil)

	settings := map[string]any{
		"name": "导航 Web", "redirectUris": []string{"https://track.example/cb"}, "postLogoutRedirectUris": []string{},
		"defaultApi": track, "sessionIdleTimeout": 7 * 86400, "refreshTokens": true,
		"webhookUrl": "https://track.example/hook", "webhookSecret": "s3cret",
		"appleAppIds": []string{}, "androidApps": []any{},
	}
	if code := e.call("POST", ro, "/applications", map[string]any{"type": "confidential", "settings": settings}, nil); code != 403 {
		t.Errorf("readonly creates: %d", code)
	}
	var created struct {
		Application application
		Secret      string
	}
	if code := e.call("POST", owner, "/applications", map[string]any{"type": "confidential", "settings": settings}, &created); code != 200 || created.Secret == "" {
		t.Fatalf("create: %d %+v", code, created)
	}
	a := created.Application
	if a.ClientID == "" || a.Type != "confidential" || a.DefaultAPI != track || a.SessionIdleTimeout != 7*86400 ||
		a.WebhookURL != "https://track.example/hook" || a.WebhookSecretUpdatedAt == nil {
		t.Errorf("created: %+v", a)
	}
	path := "/applications/" + a.ClientID
	secret := func() string {
		var c struct{ Secret string }
		if err := e.pool.QueryRow(t.Context(), "SELECT encode(secret_hash, 'hex') FROM applications WHERE client_id = $1", a.ClientID).Scan(&c.Secret); err != nil {
			t.Fatal(err)
		}
		return c.Secret
	}
	if err := oidcstore.VerifyClientSecret(t.Context(), secret(), created.Secret); err != nil {
		t.Errorf("the secret shown does not authenticate: %v", err)
	}

	// Edit: an empty webhook secret keeps the stored one.
	settings["name"], settings["webhookSecret"], settings["defaultApi"] = "导航后台", "", ""
	settings["appleAppIds"] = []string{"ABCDE12345.com.example.track"}
	settings["androidApps"] = []any{map[string]any{"packageName": "com.example.track", "sha256CertFingerprints": []string{fingerprint}}}
	if code := e.call("PUT", owner, path, settings, nil); code != 204 {
		t.Fatalf("update: %d", code)
	}
	var got application
	if code := e.get(ro, path, &got); code != 200 || got.Name != "导航后台" || got.DefaultAPI != "" ||
		got.WebhookSecretUpdatedAt == nil || len(got.AppleAppIDs) != 1 || got.AndroidApps[0].SHA256CertFingerprints[0] != fingerprint {
		t.Errorf("after update: %d %+v", code, got)
	}

	for name, edit := range map[string]func(map[string]any){
		"unknown API":           func(s map[string]any) { s["defaultApi"] = "https://nope.example" },
		"the Management API":    func(s map[string]any) { s["defaultApi"] = identity.ManagementAPI },
		"the Account API":       func(s map[string]any) { s["defaultApi"] = identity.AccountAPI },
		"relative redirect URI": func(s map[string]any) { s["redirectUris"] = []string{"/cb"} },
		"bad Apple app ID":      func(s map[string]any) { s["appleAppIds"] = []string{"com.example.track"} },
		"bad fingerprint": func(s map[string]any) {
			s["androidApps"] = []any{map[string]any{"packageName": "com.example.track", "sha256CertFingerprints": []string{"AB"}}}
		},
	} {
		s := map[string]any{}
		for k, v := range settings {
			s[k] = v
		}
		edit(s)
		if code := e.call("PUT", owner, path, s, nil); code != 422 {
			t.Errorf("%s: %d, want 422", name, code)
		}
	}
	// A webhook URL needs a signing key.
	var pub struct{ Application application }
	pubSettings := map[string]any{"name": "App", "redirectUris": []string{"com.example.track:/cb"}, "postLogoutRedirectUris": []string{},
		"defaultApi": track, "refreshTokens": true, "webhookUrl": "https://x.example/hook", "appleAppIds": []string{}, "androidApps": []any{}}
	if code := e.call("POST", owner, "/applications", map[string]any{"type": "public", "settings": pubSettings}, nil); code != 422 {
		t.Errorf("webhook without a key: %d", code)
	}
	pubSettings["webhookUrl"] = ""
	if code := e.call("POST", owner, "/applications", map[string]any{"type": "public", "settings": pubSettings}, &pub); code != 200 || pub.Application.Type != "public" {
		t.Errorf("create public: %d", code)
	}

	// A new secret replaces the old one; public Applications have none.
	old := secret()
	var rotated struct{ Secret string }
	if code := e.call("POST", owner, path+"/secret", nil, &rotated); code != 200 || rotated.Secret == created.Secret || secret() == old {
		t.Errorf("rotate: %d", code)
	}
	if code := e.call("POST", owner, "/applications/"+pub.Application.ClientID+"/secret", nil, nil); code != 409 {
		t.Errorf("rotate a public Application's secret: %d", code)
	}

	// The console and the account center are built in.
	var list struct{ Applications []application }
	if code := e.get(ro, "/applications", &list); code != 200 || len(list.Applications) != 4 || !list.Applications[1].Builtin {
		t.Errorf("list: %d %+v", code, list)
	}
	if code := e.call("PUT", owner, "/applications/stars-auth-console", settings, nil); code != 409 {
		t.Errorf("edit the console: %d", code)
	}
	if code := e.call("DELETE", owner, "/applications/stars-auth-console", nil, nil); code != 409 {
		t.Errorf("delete the console: %d", code)
	}
	if code := e.call("DELETE", owner, path, nil, nil); code != 204 {
		t.Errorf("delete: %d", code)
	}
	if code := e.get(ro, path, nil); code != 404 {
		t.Errorf("deleted Application: %d", code)
	}
}

// wellKnown fetches a /.well-known/ file without following redirects: what
// Apple's and Google's crawlers do.
func wellKnown(t *testing.T, issuer, path string) (*http.Response, string) {
	t.Helper()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(issuer + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

// TestWellKnownAssociation is the two files iOS and Android read to allow
// this domain's Passkeys and password autofill in the registered native
// Apps (docs/spec/authentication.md「密码管理器适配」).
func TestWellKnownAssociation(t *testing.T) {
	e := start(t)
	owner := e.token(e.owner, nil)

	// Nothing registered yet: both files are still valid JSON, empty.
	for path, want := range map[string]string{
		"/.well-known/apple-app-site-association": `{"webcredentials":{"apps":[]}}`,
		"/.well-known/assetlinks.json":            `[]`,
	} {
		resp, body := wellKnown(t, e.issuer, path)
		if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/json" {
			t.Errorf("%s: %d %s", path, resp.StatusCode, resp.Header.Get("Content-Type"))
		}
		var got any
		if json.Unmarshal([]byte(body), &got) != nil || strings.TrimSpace(body) != want {
			t.Errorf("%s: %s, want %s", path, body, want)
		}
	}

	// Register a native App's association; both files answer with it.
	settings := map[string]any{"name": "星选 App", "redirectUris": []string{}, "postLogoutRedirectUris": []string{},
		"refreshTokens": true, "appleAppIds": []string{"ABCDE12345.com.example.app"},
		"androidApps": []any{map[string]any{"packageName": "com.example.app", "sha256CertFingerprints": []string{fingerprint}}}}
	if code := e.call("POST", owner, "/applications", map[string]any{"type": "public", "settings": settings}, nil); code != 200 {
		t.Fatalf("create: %d", code)
	}

	_, body := wellKnown(t, e.issuer, "/.well-known/apple-app-site-association")
	var aasa struct {
		Webcredentials struct {
			Apps []string `json:"apps"`
		} `json:"webcredentials"`
	}
	if json.Unmarshal([]byte(body), &aasa) != nil || len(aasa.Webcredentials.Apps) != 1 || aasa.Webcredentials.Apps[0] != "ABCDE12345.com.example.app" {
		t.Errorf("apple-app-site-association: %s", body)
	}

	_, body = wellKnown(t, e.issuer, "/.well-known/assetlinks.json")
	var statements []struct {
		Relation []string `json:"relation"`
		Target   struct {
			Namespace              string   `json:"namespace"`
			PackageName            string   `json:"package_name"`
			SHA256CertFingerprints []string `json:"sha256_cert_fingerprints"`
		} `json:"target"`
	}
	if json.Unmarshal([]byte(body), &statements) != nil || len(statements) != 1 {
		t.Fatalf("assetlinks.json: %s", body)
	}
	s := statements[0]
	if len(s.Relation) != 2 || s.Relation[0] != "delegate_permission/common.get_login_creds" || s.Relation[1] != "delegate_permission/common.handle_all_urls" ||
		s.Target.Namespace != "android_app" || s.Target.PackageName != "com.example.app" ||
		len(s.Target.SHA256CertFingerprints) != 1 || s.Target.SHA256CertFingerprints[0] != fingerprint {
		t.Errorf("statement: %+v", s)
	}
}
