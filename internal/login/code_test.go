package login_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"html"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"

	altcha "github.com/altcha-org/altcha-lib-go/v2"

	_ "github.com/zibyn/stars-auth/internal/channel/webhook"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/otp"
	"github.com/zibyn/stars-auth/internal/pow"
)

// inbox is the Webhook Channel's receiver: the last code sent to each
// Identifier.
type inbox struct {
	mu    sync.Mutex
	codes map[string]string
}

func (in *inbox) ServeHTTP(_ http.ResponseWriter, r *http.Request) {
	var m struct{ To, Code string }
	_ = json.NewDecoder(r.Body).Decode(&m)
	in.mu.Lock()
	defer in.mu.Unlock()
	in.codes[m.To] = m.Code
}

func (in *inbox) take(to string) string {
	in.mu.Lock()
	defer in.mu.Unlock()
	code := in.codes[to]
	delete(in.codes, to)
	return code
}

// solve fetches a PoW challenge and solves it, as the widget does.
func (e *env) solve() string {
	e.t.Helper()
	_, body := e.do("GET", "/altcha/challenge", nil)
	var ch altcha.Challenge
	if err := json.Unmarshal([]byte(body), &ch); err != nil {
		e.t.Fatalf("challenge: %v %s", err, body)
	}
	sol, err := altcha.SolveChallenge(altcha.SolveChallengeOptions{Challenge: ch, DeriveKey: altcha.DeriveKeyPBKDF2()})
	if err != nil || sol == nil {
		e.t.Fatalf("solve: %v", err)
	}
	js, _ := json.Marshal(altcha.Payload{Challenge: ch, Solution: *sol})
	return base64.StdEncoding.EncodeToString(js)
}

// codeLogin sends a code to typed from page and enters it; it returns the
// final response and the normalised Identifier the code went to.
func (e *env) codeLogin(page, typed, to string) (*http.Response, string) {
	e.t.Helper()
	// Clear the 60-second limit left by earlier logins.
	if _, err := e.pool.Exec(context.Background(), "UPDATE sends SET sent_at = sent_at - interval '1 minute'"); err != nil {
		e.t.Fatal(err)
	}
	resp, page := e.post(page, url.Values{"op": {"send"}, "identifier": {typed}, "altcha": {e.solve()}})
	code := e.inbox.take(to)
	if resp.StatusCode != 200 || code == "" {
		e.t.Fatalf("send to %s: %d %s", to, resp.StatusCode, page)
	}
	if !strings.Contains(page, `autocomplete="one-time-code"`) || strings.Count(page, `name="code"`) != 1 {
		e.t.Errorf("code page lacks a single one-time-code input:\n%s", page)
	}
	return e.post(page, url.Values{"op": {"verify"}, "identifier": {to}, "code": {code}})
}

func (e *env) userinfo(accessToken string) map[string]any {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.issuer+"/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	var claims map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
		e.t.Fatal(err)
	}
	return claims
}

func TestCodeLoginSignsUp(t *testing.T) {
	e := start(t)
	const phone = "+8613800138000"

	_, page := e.authorize("&scope=openid+phone")
	if !strings.Contains(page, "<altcha-widget") {
		t.Errorf("login page lacks the PoW widget")
	}
	// No PoW solution, no code.
	resp, body := e.post(page, url.Values{"op": {"send"}, "identifier": {"138 0013 8000"}})
	if !strings.Contains(body, pow.ErrUnsolved.Error()) || e.inbox.take(phone) != "" {
		t.Fatalf("send without PoW: %d %s", resp.StatusCode, body)
	}
	// A wrong code is refused.
	resp, body = e.post(page, url.Values{"op": {"verify"}, "identifier": {phone}, "code": {"123456"}})
	if !strings.Contains(body, otp.ErrWrongCode.Error()) {
		t.Fatalf("wrong code: %d %s", resp.StatusCode, body)
	}

	resp, _ = e.codeLogin(page, "138 0013 8000", phone)
	tok := e.exchange(clientID, callback, e.code(resp))
	claims := e.claims(tok.IDToken)
	sub, _ := claims["sub"].(string)
	if sub == "" || !slices.Equal(claims["amr"].([]any), []any{"sms"}) ||
		claims["phone_number"] != phone || claims["phone_number_verified"] != true || claims["email"] != nil {
		t.Errorf("id token claims: %v", claims)
	}
	if info := e.userinfo(tok.AccessToken); info["sub"] != sub || info["phone_number"] != phone {
		t.Errorf("userinfo: %v", info)
	}

	// The same phone number on another browser is the same User.
	e.newBrowser()
	_, page = e.authorize("")
	resp, _ = e.codeLogin(page, phone, phone)
	if again := e.idToken(e.code(resp)); again["sub"] != sub || again["phone_number"] != nil {
		t.Errorf("second login: %v", again)
	}

	// Email codes: another User, amr otp, email claims.
	e.newBrowser()
	_, page = e.authorize("&scope=openid+email")
	resp, _ = e.codeLogin(page, " Someone@Example.com", "someone@example.com")
	claims = e.idToken(e.code(resp))
	if claims["sub"] == sub || !slices.Equal(claims["amr"].([]any), []any{"otp"}) ||
		claims["email"] != "someone@example.com" || claims["email_verified"] != true {
		t.Errorf("email login: %v", claims)
	}
}

func TestRequirePhoneMakesUserBindOne(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	owner, err := e.ids.SignIn(ctx, "phone", "+8613800138000")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE settings SET require_phone = true"); err != nil {
		t.Fatal(err)
	}

	_, page := e.authorize("&scope=openid+phone")
	resp, page := e.codeLogin(page, "a@example.com", "a@example.com")
	if resp.StatusCode != 200 || !strings.Contains(page, "绑定手机号") {
		t.Fatalf("want the bind page, got %d %s", resp.StatusCode, page)
	}
	// Signing in again does not skip it.
	resp, page = e.authorize("&scope=openid+phone")
	if resp.StatusCode != 200 || !strings.Contains(page, "绑定手机号") {
		t.Fatalf("second authorize: want the bind page, got %d", resp.StatusCode)
	}
	// Only a phone number will do.
	resp, body := e.post(page, url.Values{"op": {"send"}, "identifier": {"b@example.com"}, "altcha": {e.solve()}})
	if !strings.Contains(html.UnescapeString(body), identity.ErrPhone.Error()) {
		t.Errorf("bind an email: %d %s", resp.StatusCode, body)
	}
	// Never one another User holds.
	resp, body = e.codeLogin(page, "13800138000", "+8613800138000")
	if !strings.Contains(body, identity.ErrIdentifierTaken.Error()) {
		t.Fatalf("bind a taken phone: %d %s", resp.StatusCode, body)
	}
	resp, _ = e.codeLogin(page, "13900139000", "+8613900139000")
	claims := e.idToken(e.code(resp))
	if claims["sub"] == owner || claims["phone_number"] != "+8613900139000" {
		t.Errorf("after binding: %v", claims)
	}
	if sub, _ := e.ids.SignIn(ctx, "email", "a@example.com"); sub != claims["sub"] {
		t.Errorf("phone bound to %v, email belongs to %s", claims["sub"], sub)
	}
}
