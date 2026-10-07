package login_test

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

// signIn logs the owner in through the password form and redeems the code.
func (e *env) signIn() tokens {
	e.t.Helper()
	_, page := e.authorize("")
	resp, _ := e.submit(page, "owner", "password1")
	return e.exchange(clientID, callback, e.code(resp))
}

// refresh redeems a refresh token; a failure comes back as the error code.
func (e *env) refresh(rt string) (tokens, string) {
	e.t.Helper()
	resp, body := e.do("POST", "/token", url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {clientID},
	})
	var out struct {
		tokens
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		e.t.Fatalf("refresh: %d %s", resp.StatusCode, body)
	}
	return out.tokens, out.Error
}

// signedIn reports whether the browser still has a Session.
func (e *env) signedIn() bool {
	e.t.Helper()
	resp, _ := e.authorize("&prompt=none")
	loc, _ := url.Parse(resp.Header.Get("Location"))
	return loc.Query().Get("code") != ""
}

func TestRefreshTokenReuseEndsTheSession(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	first := e.signIn()
	if first.RefreshToken == "" {
		t.Fatal("no refresh token")
	}

	second, errCode := e.refresh(first.RefreshToken)
	if errCode != "" || second.RefreshToken == "" || second.RefreshToken == first.RefreshToken || second.AccessToken == "" {
		t.Fatalf("refresh did not rotate: %q %+v", errCode, second)
	}

	if _, errCode := e.refresh(first.RefreshToken); errCode != "invalid_grant" {
		t.Errorf("reused refresh token: %q, want invalid_grant", errCode)
	}
	// The whole Session is over: the rotated token and the browser too.
	if _, errCode := e.refresh(second.RefreshToken); errCode != "invalid_grant" {
		t.Errorf("refresh after reuse: %q, want invalid_grant", errCode)
	}
	if e.signedIn() {
		t.Error("browser Session survived refresh token reuse")
	}
}

// Whether refresh tokens are issued is the Application's setting;
// offline_access changes nothing.
func TestRefreshTokensFollowTheApplication(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	_, page := e.authorize("&scope=openid+offline_access")
	resp, _ := e.submit(page, "owner", "password1")
	if tok := e.exchange(clientID, callback, e.code(resp)); tok.RefreshToken == "" {
		t.Error("offline_access: no refresh token")
	}

	if _, err := e.pool.Exec(context.Background(), "UPDATE applications SET refresh_tokens = false WHERE client_id = $1", clientID); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{"openid", "openid offline_access"} {
		resp, _ := e.authorize("&scope=" + url.QueryEscape(scope))
		if tok := e.exchange(clientID, callback, e.code(resp)); tok.RefreshToken != "" {
			t.Errorf("%s: refresh token issued with refresh tokens off", scope)
		}
	}
}

// Revoking an OIDC refresh token ends that grant, not the browser Session.
func TestRevokeRefreshToken(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	tok := e.signIn()
	resp, body := e.do("POST", "/revoke", url.Values{"token": {tok.RefreshToken}, "client_id": {clientID}})
	if resp.StatusCode != 200 {
		t.Fatalf("revoke: %d %s", resp.StatusCode, body)
	}
	if _, errCode := e.refresh(tok.RefreshToken); errCode != "invalid_grant" {
		t.Errorf("refresh after revocation: %q, want invalid_grant", errCode)
	}
	if !e.signedIn() {
		t.Error("revoking a refresh token ended the browser Session")
	}
	// Unknown tokens are fine too (RFC 7009 §2.2).
	if resp, _ := e.do("POST", "/revoke", url.Values{"token": {"nope"}, "client_id": {clientID}}); resp.StatusCode != 200 {
		t.Errorf("revoke unknown token: %d", resp.StatusCode)
	}
}

// RP-Initiated Logout ends the browser Session and the refresh tokens under
// it. With the User's ID token as hint it goes straight through; without,
// the User confirms first.
func TestRPInitiatedLogout(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	tok := e.signIn()

	resp, _ := e.do("GET", "/logout?"+url.Values{
		"id_token_hint": {tok.IDToken}, "post_logout_redirect_uri": {afterLogout}, "state": {"st"},
	}.Encode(), nil)
	if loc := resp.Header.Get("Location"); loc != afterLogout+"?state=st" {
		t.Errorf("logout: %d %q", resp.StatusCode, loc)
	}
	if e.signedIn() {
		t.Error("browser Session survived logout")
	}
	if _, errCode := e.refresh(tok.RefreshToken); errCode != "invalid_grant" {
		t.Errorf("refresh after logout: %q, want invalid_grant", errCode)
	}

	e.signIn()
	resp, page := e.do("GET", "/logout", nil)
	if resp.StatusCode != 200 || !actionRE.MatchString(page) {
		t.Fatalf("logout without hint: want a confirmation, got %d %s", resp.StatusCode, page)
	}
	if !e.signedIn() {
		t.Fatal("logged out before confirming")
	}
	resp, page = e.post(page, url.Values{"logout": {"1"}})
	if resp.StatusCode != 200 || !strings.Contains(page, "已退出") {
		t.Errorf("confirm logout: %d %s", resp.StatusCode, page)
	}
	if e.signedIn() {
		t.Error("browser Session survived confirmed logout")
	}
}

// Logging in again as the same User renews the browser Session in place, so
// the refresh tokens under it keep working.
func TestReloginKeepsTheSession(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	tok := e.signIn()
	_, page := e.authorize("&prompt=login")
	resp, _ := e.submit(page, "owner", "password1")
	e.code(resp)
	if _, errCode := e.refresh(tok.RefreshToken); errCode != "" {
		t.Errorf("refresh after re-login: %q", errCode)
	}
}
