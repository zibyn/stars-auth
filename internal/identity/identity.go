// Package identity owns Users, their Identifiers and Credentials, and the
// first-start bootstrap that creates the first owner.
package identity

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
)

// ManagementAPI is the built-in API whose Roles make a User an admin.
const ManagementAPI = "urn:stars-auth:management-api"

// Invalid is an error safe to show the person who caused it.
type Invalid string

func (e Invalid) Error() string { return string(e) }

const (
	ErrSetupToken       Invalid = "setup token 无效"
	ErrSetupClosed      Invalid = "引导已完成"
	ErrUsername         Invalid = "用户名须为 3–32 位字母、数字或 . _ -"
	ErrPasswordTooShort Invalid = "密码至少 8 位"
	ErrBadCredentials   Invalid = "用户名或密码错误"
)

type Store struct {
	pool    *pgxpool.Pool
	q       *sqlc.Queries
	keyring *crypt.Keyring
}

func New(pool *pgxpool.Pool, keyring *crypt.Keyring) *Store {
	return &Store{pool: pool, q: sqlc.New(pool), keyring: keyring}
}

var setupAAD = []byte("setup_token")

// SetupToken returns the one-time token that opens the setup page, creating
// it on first call; "" once the first owner exists.
func (s *Store) SetupToken(ctx context.Context) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	q := s.q.WithTx(tx)
	setup, err := q.LockSetup(ctx)
	if err != nil || setup.SetupDone {
		return "", err
	}
	if setup.SetupToken != nil {
		token, err := s.keyring.Open(setup.SetupToken, setupAAD)
		return string(token), err
	}
	token := rand.Text()
	sealed, err := s.keyring.Seal([]byte(token), setupAAD)
	if err != nil {
		return "", err
	}
	if err := q.SetSetupToken(ctx, sealed); err != nil {
		return "", err
	}
	return token, tx.Commit(ctx)
}

// Bootstrap creates the first owner with a username and password, then closes
// the setup page for good. It returns the new User's sub.
func (s *Store) Bootstrap(ctx context.Context, token, username, password string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	q := s.q.WithTx(tx)
	setup, err := q.LockSetup(ctx) // serialises concurrent bootstraps
	if err != nil {
		return "", err
	}
	if setup.SetupDone {
		return "", ErrSetupClosed
	}
	want, err := s.keyring.Open(setup.SetupToken, setupAAD)
	if err != nil || subtle.ConstantTimeCompare(want, []byte(token)) != 1 {
		return "", ErrSetupToken
	}
	if username, err = checkUsername(username); err != nil {
		return "", err
	}
	if utf8.RuneCountInString(password) < 8 {
		return "", ErrPasswordTooShort
	}
	hash, err := hashPassword(password)
	if err != nil {
		return "", err
	}
	sub := rand.Text()
	if err := q.CreateUser(ctx, sub); err != nil {
		return "", err
	}
	if err := q.AddIdentifier(ctx, sqlc.AddIdentifierParams{UserID: sub, Kind: "username", Value: username}); err != nil {
		return "", err
	}
	if err := q.SetPassword(ctx, sqlc.SetPasswordParams{UserID: sub, Hash: hash}); err != nil {
		return "", err
	}
	if err := q.AssignRole(ctx, sqlc.AssignRoleParams{UserID: sub, Api: ManagementAPI, Role: "owner"}); err != nil {
		return "", err
	}
	if err := q.CloseSetup(ctx); err != nil {
		return "", err
	}
	return sub, tx.Commit(ctx)
}

// CheckPassword returns the sub of the User with this Identifier (username,
// phone or email) whose password matches, if the password login setting lets
// them in.
func (s *Store) CheckPassword(ctx context.Context, identifier, password string) (string, error) {
	row, err := s.q.PasswordByIdentifier(ctx, strings.ToLower(strings.TrimSpace(identifier)))
	if err != nil {
		_, _ = verifyPassword(dummyHash, password) // unknown Identifiers take as long as known ones
		return "", ErrBadCredentials
	}
	if ok, err := verifyPassword(row.Hash, password); err != nil || !ok {
		return "", ErrBadCredentials
	}
	setting, err := s.q.PasswordLogin(ctx)
	if err != nil {
		return "", err
	}
	if setting == "off" || setting == "admins" && !row.Admin {
		return "", ErrBadCredentials
	}
	return row.UserID, nil
}

var usernameRE = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

// checkUsername normalises a username. With no '@' or '+' it can never read
// as an email or phone number.
func checkUsername(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if !usernameRE.MatchString(s) {
		return "", ErrUsername
	}
	return s, nil
}
