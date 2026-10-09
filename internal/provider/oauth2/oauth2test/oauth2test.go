// Package oauth2test is a fake OAuth2 upstream for tests: it approves the
// browser at its authorization endpoint, exchanges the code it gave for an
// access token, and answers userinfo with the JSON a test sets. Its paths
// are GitHub's, so a test can point the GitHub Provider type at it as it
// stands.
package oauth2test

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
)

// ClientID and ClientSecret are the client credentials the fake expects.
const (
	ClientID     = "cid"
	ClientSecret = "shh"
)

// Fake is an OAuth2 upstream, signing everyone in as whatever its Userinfo
// says. Set its fields between requests.
type Fake struct {
	t *testing.T
	// URL is where its OAuth endpoints listen.
	URL string
	// API is where its userinfo is, on a server of its own: GitHub's is at
	// api.github.com while its OAuth endpoints are at github.com, and one
	// host for both would hide a mix-up.
	API string
	// Userinfo is the JSON its userinfo endpoint answers.
	Userinfo map[string]any
	// FailToken and FailUserinfo make those endpoints answer 400.
	FailToken, FailUserinfo bool

	// Last is the last authorization request's query.
	Last url.Values
	// TokenForm is the last token request's form, TokenAccept its Accept
	// header.
	TokenForm   url.Values
	TokenAccept string
	// Bearer is the last userinfo request's Authorization header,
	// UserinfoAccept its Accept header.
	Bearer         string
	UserinfoAccept string

	mu    sync.Mutex
	codes map[string]url.Values // code → the authorization request it came from
}

// Start runs a fake OAuth2 upstream.
func Start(t *testing.T) *Fake {
	t.Helper()
	f := &Fake{t: t, Userinfo: map[string]any{"id": 42, "login": "octocat"}, codes: map[string]url.Values{}}
	oauth := http.NewServeMux()
	for _, path := range []string{"/authorize", "/login/oauth/authorize"} {
		oauth.HandleFunc("GET "+path, f.authorize)
	}
	for _, path := range []string{"/token", "/login/oauth/access_token"} {
		oauth.HandleFunc("POST "+path, f.token)
	}
	api := http.NewServeMux()
	for _, path := range []string{"/userinfo", "/user"} {
		api.HandleFunc("GET "+path, f.userinfo)
	}
	ts, ats := httptest.NewServer(oauth), httptest.NewServer(api)
	t.Cleanup(ts.Close)
	t.Cleanup(ats.Close)
	f.URL, f.API = ts.URL, ats.URL
	return f
}

// Config is the settings of a generic OAuth2 Provider at this fake: its
// endpoints, the client credentials, and "id" as the user ID field.
func (f *Fake) Config() map[string]string {
	return map[string]string{
		"authorization_endpoint": f.URL + "/authorize",
		"token_endpoint":         f.URL + "/token",
		"userinfo_endpoint":      f.API + "/userinfo",
		"scope":                  "read:user",
		"user_id_field":          "id",
		"client_id":              ClientID,
		"client_secret":          ClientSecret,
	}
}

// SignIn is the User signing in at authURL: it takes the browser there and
// returns the parameters the upstream sends it back with.
func (f *Fake) SignIn(authURL string) url.Values {
	f.t.Helper()
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Get(authURL)
	if err != nil {
		f.t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	loc, err := resp.Location()
	if err != nil {
		f.t.Fatalf("authorize: %d %v", resp.StatusCode, err)
	}
	return loc.Query()
}

// authorize records the request and sends the browser back to the
// redirect_uri with a code of its own.
func (f *Fake) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code := rand.Text()
	f.mu.Lock()
	f.Last, f.codes[code] = q, q
	f.mu.Unlock()
	to, err := url.Parse(q.Get("redirect_uri"))
	if err != nil || to.Host == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	to.RawQuery = url.Values{"code": {code}, "state": {q.Get("state")}}.Encode()
	http.Redirect(w, r, to.String(), http.StatusFound)
}

// token exchanges a code this fake issued, as client_secret_post: anything
// else about the request is refused.
func (f *Fake) token(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	req, ok := f.codes[r.PostFormValue("code")]
	delete(f.codes, r.PostFormValue("code"))
	f.mu.Unlock()
	f.TokenForm, f.TokenAccept = r.PostForm, r.Header.Get("Accept")
	sum := sha256.Sum256([]byte(r.PostFormValue("code_verifier")))
	ok = ok && !f.FailToken &&
		r.PostFormValue("grant_type") == "authorization_code" &&
		r.PostFormValue("client_id") == ClientID && r.PostFormValue("client_secret") == ClientSecret &&
		r.PostFormValue("redirect_uri") == req.Get("redirect_uri") &&
		base64.RawURLEncoding.EncodeToString(sum[:]) == req.Get("code_challenge")
	if !ok {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "at-" + r.PostFormValue("code"), "token_type": "bearer", "scope": req.Get("scope"),
	})
}

// userinfo says who signed in, as the test set Userinfo.
func (f *Fake) userinfo(w http.ResponseWriter, r *http.Request) {
	f.Bearer, f.UserinfoAccept = r.Header.Get("Authorization"), r.Header.Get("Accept")
	if f.FailUserinfo {
		http.Error(w, `{"error":"invalid_token"}`, http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(f.Userinfo)
}
