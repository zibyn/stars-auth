package server

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestRoutes(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":    {Data: []byte("shell")},
		"assets/app.js": {Data: []byte("js")},
	}
	var dbErr error
	h := New(func(context.Context) error { return dbErr }, SPA(fsys), nil)

	for _, tc := range []struct {
		path string
		code int
		body string
	}{
		{"/healthz", 200, "ok"},
		{"/assets/app.js", 200, "js"},
		{"/admin/users", 200, "shell"}, // client route falls back to the shell
		{"/assets/missing.js", 404, ""},
		{"/assets/", 200, "shell"}, // never a directory listing
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.code || (tc.body != "" && w.Body.String() != tc.body) {
			t.Errorf("%s: %d %q", tc.path, w.Code, w.Body.String())
		}
	}

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 302 || w.Header().Get("Location") != "/account" {
		t.Errorf("/: %d -> %q", w.Code, w.Header().Get("Location"))
	}

	dbErr = errors.New("down")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/healthz", nil))
	if w.Code != 503 {
		t.Errorf("healthz with db down: %d", w.Code)
	}
}
