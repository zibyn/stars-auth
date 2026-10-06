package identity

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db"
	"github.com/zibyn/stars-auth/internal/db/dbtest"
)

func setup(t *testing.T) *Store {
	t.Helper()
	pool := dbtest.Fresh(t)
	if err := db.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	keyring, err := crypt.NewKeyring(1, map[byte][]byte{1: bytes.Repeat([]byte{7}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	return New(pool, keyring)
}

func TestBootstrap(t *testing.T) {
	s := setup(t)
	ctx := context.Background()

	token, err := s.SetupToken(ctx)
	if err != nil || token == "" {
		t.Fatalf("setup token: %q %v", token, err)
	}
	// Restarts and other replicas print the same token.
	if again, _ := s.SetupToken(ctx); again != token {
		t.Fatalf("token changed: %q -> %q", token, again)
	}

	for _, tc := range []struct {
		token, username, password string
		want                      error
	}{
		{"wrong", "root", "password1", ErrSetupToken},
		{token, "root", "short", ErrPasswordTooShort},
		{token, "密码八位密码八位", "password1", ErrUsername},
		{token, "a@b.c", "password1", ErrUsername},
	} {
		if _, err := s.Bootstrap(ctx, tc.token, tc.username, tc.password); !errors.Is(err, tc.want) {
			t.Errorf("Bootstrap(%q, %q, %q) = %v, want %v", tc.token, tc.username, tc.password, err, tc.want)
		}
	}

	// Eight characters, not eight bytes.
	sub, err := s.Bootstrap(ctx, token, "Root", "密码八位密码八位")
	if err != nil || sub == "" {
		t.Fatalf("bootstrap: %q %v", sub, err)
	}

	if _, err := s.Bootstrap(ctx, token, "other", "password1"); !errors.Is(err, ErrSetupClosed) {
		t.Errorf("second bootstrap: %v", err)
	}
	if tok, err := s.SetupToken(ctx); tok != "" || err != nil {
		t.Errorf("setup token after bootstrap: %q %v", tok, err)
	}

	// The owner logs in by password, the username case-insensitively.
	if got, err := s.CheckPassword(ctx, "root", "密码八位密码八位"); got != sub || err != nil {
		t.Errorf("CheckPassword = %q %v, want %q", got, err, sub)
	}
	for _, login := range []string{"ROOT", " root "} {
		if got, _ := s.CheckPassword(ctx, login, "密码八位密码八位"); got != sub {
			t.Errorf("login %q: %q", login, got)
		}
	}
	for _, tc := range [][2]string{{"root", "wrong-password"}, {"nobody", "密码八位密码八位"}} {
		if _, err := s.CheckPassword(ctx, tc[0], tc[1]); !errors.Is(err, ErrBadCredentials) {
			t.Errorf("CheckPassword(%q, %q) = %v", tc[0], tc[1], err)
		}
	}

	// Closed for good: even with no admin left, setup does not reopen.
	if _, err := s.pool.Exec(ctx, "DELETE FROM user_roles"); err != nil {
		t.Fatal(err)
	}
	if tok, _ := s.SetupToken(ctx); tok != "" {
		t.Errorf("setup reopened once no admin was left")
	}
}

func TestPasswordLoginSetting(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	token, _ := s.SetupToken(ctx)
	owner, err := s.Bootstrap(ctx, token, "owner", "password1")
	if err != nil {
		t.Fatal(err)
	}
	// No product path creates a non-admin User with a password yet.
	hash, err := hashPassword("password2")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO users (id) VALUES ('u2');
		INSERT INTO identifiers VALUES ('u2', 'username', 'user');
		INSERT INTO passwords VALUES ('u2', '`+hash+`')`); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		setting     string
		owner, user bool // can log in
	}{
		{"admins", true, false}, // the default
		{"all", true, true},
		{"off", false, false},
	} {
		if tc.setting != "admins" {
			if _, err := s.pool.Exec(ctx, "UPDATE settings SET password_login = $1", tc.setting); err != nil {
				t.Fatal(err)
			}
		}
		got, err := s.CheckPassword(ctx, "owner", "password1")
		if (got == owner) != tc.owner {
			t.Errorf("%s: owner = %q %v", tc.setting, got, err)
		}
		got, err = s.CheckPassword(ctx, "user", "password2")
		if (got == "u2") != tc.user {
			t.Errorf("%s: user = %q %v", tc.setting, got, err)
		}
	}
}
