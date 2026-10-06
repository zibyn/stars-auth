package server

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestTrustProxies(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	for _, tc := range []struct {
		name, peer, xff, proto string
		wantAddr, wantProto    string
	}{
		{"untrusted peer: headers dropped", "1.2.3.4:5", "9.9.9.9", "https", "1.2.3.4:5", ""},
		{"trusted peer: client from XFF", "10.0.0.1:5", "9.9.9.9", "https", "9.9.9.9:0", "https"},
		{"spoofed left entry ignored", "10.0.0.1:5", "6.6.6.6, 9.9.9.9", "", "9.9.9.9:0", ""},
		{"trusted hops skipped", "10.0.0.1:5", "9.9.9.9, 10.0.0.2", "", "9.9.9.9:0", ""},
		{"trusted peer, no XFF", "10.0.0.1:5", "", "", "10.0.0.1:5", ""},
		{"garbage XFF keeps peer", "10.0.0.1:5", "9.9.9.9, junk", "", "10.0.0.1:5", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got *http.Request
			h := trustProxies(trusted, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = r }))
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = tc.peer
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if tc.proto != "" {
				r.Header.Set("X-Forwarded-Proto", tc.proto)
			}
			h.ServeHTTP(httptest.NewRecorder(), r)
			if got.RemoteAddr != tc.wantAddr || got.Header.Get("X-Forwarded-Proto") != tc.wantProto {
				t.Fatalf("RemoteAddr=%s proto=%q", got.RemoteAddr, got.Header.Get("X-Forwarded-Proto"))
			}
			if !isTrusted(trusted, tc.peer) && got.Header.Get("X-Forwarded-For") != "" {
				t.Fatal("XFF from untrusted peer leaked through")
			}
		})
	}
}
