package identity

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/db/sqlc"
)

// Lockouts (docs/spec/security-compliance.md#失败锁定).
const (
	passwordTries = 5
	// In a row: a right password starts over; failures older than the
	// cleanup's day are forgotten.
	passwordWindow = 24 * time.Hour
	passwordLock   = 15 * time.Minute
	ipFailures     = 50
	ipWindow       = time.Hour
	ipLock         = time.Hour
)

const (
	ErrPasswordLocked Invalid = "密码错误次数过多,请 15 分钟后再试,或用验证码登录"
	ErrIPLocked       Invalid = "失败次数过多,请 1 小时后再试"
	// ErrWrongCode is otp's; FromIP counts it.
	ErrWrongCode Invalid = "验证码错误或已失效"
)

// FromIP runs check, a password or code check made from ip: refused while
// ip is locked out, and a wrong password or code, or a password tried on
// a locked User, counts toward locking it out.
func (s *Store) FromIP(ctx context.Context, ip string, check func() error) error {
	key := "ip:" + ip
	if locked, err := s.q.LockedOut(ctx, key); err != nil {
		return err
	} else if locked {
		return ErrIPLocked
	}
	err := check()
	if err == ErrBadCredentials || err == ErrPasswordLocked || err == ErrWrongCode { //nolint:errorlint // never wrapped
		detail, _ := json.Marshal(map[string]string{"ip": ip})
		if _, dbErr := s.failed(ctx, key, ipFailures, ipWindow, ipLock, sqlc.AuditParams{Event: "login.ip_locked", Detail: detail}); dbErr != nil {
			return dbErr
		}
	}
	return err
}

// failed counts a failure of key; the max-th within window locks key out
// for lock, audited as audit. It reports whether it did.
// ponytail: concurrent failures can both miss the max; the next one locks.
func (s *Store) failed(ctx context.Context, key string, max int32, window, lock time.Duration, audit sqlc.AuditParams) (bool, error) {
	n, err := s.q.LoginFailed(ctx, sqlc.LoginFailedParams{Key: key, WindowSecs: window.Seconds()})
	if err != nil || n < max {
		return false, err
	}
	return true, pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.LockOut(ctx, sqlc.LockOutParams{Key: key, LockSecs: lock.Seconds()}); err != nil {
			return err
		}
		return q.Audit(ctx, audit)
	})
}

// DeleteOldLoginFailures removes day-old failures and past lockouts; run
// by the hourly cleanup.
func DeleteOldLoginFailures(ctx context.Context, pool *pgxpool.Pool) error {
	return sqlc.New(pool).DeleteOldLoginFailures(ctx)
}
