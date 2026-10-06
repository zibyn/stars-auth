package config

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var key = base64.StdEncoding.EncodeToString(make([]byte, 32))

func env(m map[string]string) func(string) string {
	base := map[string]string{
		"STARS_AUTH_DATABASE_URL": "postgres://x",
		"STARS_AUTH_MASTER_KEY":   key,
		"STARS_AUTH_ISSUER":       "https://auth.example.com",
	}
	for k, v := range m {
		base[k] = v
	}
	return func(k string) string { return base[k] }
}

func TestLoadDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != ":8080" || c.Issuer != "https://auth.example.com" || len(c.MasterKey) != 32 || len(c.TrustedProxies) != 0 {
		t.Fatalf("%+v", c)
	}
}

func TestLoadRejects(t *testing.T) {
	for name, m := range map[string]map[string]string{
		"http issuer":     {"STARS_AUTH_ISSUER": "http://auth.example.com"},
		"issuer query":    {"STARS_AUTH_ISSUER": "https://auth.example.com?x=1"},
		"issuer fragment": {"STARS_AUTH_ISSUER": "https://auth.example.com#x"},
		"issuer userinfo": {"STARS_AUTH_ISSUER": "https://u:p@auth.example.com"},
		"no issuer":       {"STARS_AUTH_ISSUER": ""},
		"no database":     {"STARS_AUTH_DATABASE_URL": ""},
		"no key":          {"STARS_AUTH_MASTER_KEY": ""},
		"short key":       {"STARS_AUTH_MASTER_KEY": base64.StdEncoding.EncodeToString(make([]byte, 16))},
		"bad base64":      {"STARS_AUTH_MASTER_KEY": "!!"},
		"both keys":       {"STARS_AUTH_MASTER_KEY_FILE": "/k"},
		"bad proxy":       {"STARS_AUTH_TRUSTED_PROXIES": "10.0.0.0/8,nope"},
	} {
		if _, err := Load(env(m)); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
}

func TestLoadKeyFileAndProxies(t *testing.T) {
	f := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(f, []byte(key+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(env(map[string]string{
		"STARS_AUTH_MASTER_KEY":      "",
		"STARS_AUTH_MASTER_KEY_FILE": f,
		"STARS_AUTH_TRUSTED_PROXIES": "10.0.0.0/8, 192.168.1.1 ,::1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.MasterKey) != 32 {
		t.Fatal("key not loaded from file")
	}
	var got []string
	for _, p := range c.TrustedProxies {
		got = append(got, p.String())
	}
	if s := strings.Join(got, ","); s != "10.0.0.0/8,192.168.1.1/32,::1/128" {
		t.Fatalf("proxies = %s", s)
	}
}
