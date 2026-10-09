package provider

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
)

const (
	// ErrTaken: the External Identity is another User's (ADR 0003).
	ErrTaken         identity.Invalid = "这个外部账号已绑定其他账号,请先在那边解绑或注销"
	ErrBoundAnother  identity.Invalid = "已绑定这个服务商的另一个账号,请先解绑"
	ErrNotYours      identity.Invalid = "这不是你绑定的外部账号"
	ErrNotAfreshAuth identity.Invalid = "请在服务商重新登录后再试"
)

// BeginAccount starts a redirect from the account center to the enabled
// Provider id, for the Session session of User userID: to bind the External
// Identity it gives, or with reauth, to reauthenticate the Session with the
// one bound. A reauthentication asks the Provider to sign the User in
// afresh (OIDC Core §3.1.2.1 prompt=login, max_age=0).
func (s *Store) BeginAccount(ctx context.Context, issuer, id, userID, session string, reauth bool) (string, error) {
	if reauth {
		if _, err := s.q.ExternalIdentitySubject(ctx, sqlc.ExternalIdentitySubjectParams{UserID: userID, Provider: id}); errors.Is(err, pgx.ErrNoRows) {
			return "", identity.ErrNotBound
		} else if err != nil {
			return "", err
		}
	}
	to, err := s.begin(ctx, issuer, id, func(stateHash []byte, nonce, verifier string) error {
		return s.q.InsertProviderAccountLogin(ctx, sqlc.InsertProviderAccountLoginParams{
			StateHash: stateHash, Provider: id, Nonce: nonce, Verifier: verifier,
			SessionID: pgtype.Text{String: session, Valid: true}, Reauth: reauth,
		})
	})
	if err != nil || !reauth {
		return to, err
	}
	u, err := url.Parse(to)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("prompt", "login")
	q.Set("max_age", "0")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// finishAccount binds ident to the User of the redirect's Session, or
// reauthenticates the Session with it.
func (s *Store) finishAccount(ctx context.Context, id string, login sqlc.TakeProviderLoginRow, ident Identity) error {
	session := login.SessionID.String
	user, err := s.q.LiveSessionUser(ctx, session)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLogin
	} else if err != nil {
		return err
	}
	if login.Reauth {
		subject, err := s.q.ExternalIdentitySubject(ctx, sqlc.ExternalIdentitySubjectParams{UserID: user, Provider: id})
		if errors.Is(err, pgx.ErrNoRows) || err == nil && subject != ident.Subject {
			return ErrNotYours
		} else if err != nil {
			return err
		}
		// max_age=0: they signed in after the redirect started, give or take
		// the clocks' skew.
		// ponytail: no auth_time is taken as the Provider honouring
		// prompt=login and max_age=0; one that ignores both reauthenticates
		// with a remembered sign-in. Refuse a missing auth_time for a
		// Provider type that turns out to.
		if !ident.AuthTime.IsZero() && ident.AuthTime.Before(login.CreatedAt.Time.Add(-time.Minute)) {
			return ErrNotAfreshAuth
		}
		return s.q.Reauthenticate(ctx, sqlc.ReauthenticateParams{ID: session, UserID: user, Amr: []string{"fed"}})
	}
	var token []byte
	if ident.Token != "" {
		if token, err = s.keyring.Seal([]byte(ident.Token), tokenAAD(id, ident.Subject)); err != nil {
			return err
		}
	}
	err = s.q.BindExternalIdentity(ctx, sqlc.BindExternalIdentityParams{Provider: id, Subject: ident.Subject, UserID: user, Token: token})
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return err
	}
	if pgErr.ConstraintName != "external_identities_pkey" {
		return ErrBoundAnother
	}
	if owner, err := s.q.UserByExternalIdentity(ctx, sqlc.UserByExternalIdentityParams{Provider: id, Subject: ident.Subject}); err == nil && owner.UserID == user {
		return nil // bound already
	}
	return ErrTaken
}

// Unbind removes the User's External Identity at the Provider, unless it is
// their last way to sign in (docs/spec/identity.md#不变式), then tells the
// Provider if it is an Unlinker. The caller audits the unbinding.
func (s *Store) Unbind(ctx context.Context, userID, providerID string) error {
	var gone sqlc.DeleteExternalIdentityRow
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		_, err := q.LockUser(ctx, userID)
		if err == nil {
			gone, err = q.DeleteExternalIdentity(ctx, sqlc.DeleteExternalIdentityParams{UserID: userID, Provider: providerID})
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return identity.ErrNotBound
		} else if err != nil {
			return err
		}
		paths, err := q.LoginPaths(ctx, userID)
		if err == nil && !identity.CanSignIn(paths) {
			err = identity.ErrLastLoginPath
		}
		return err
	})
	if err != nil {
		return err
	}
	ctx = context.WithoutCancel(ctx)
	if err := s.unlink(ctx, providerID, gone); err != nil {
		slog.Warn("unlink external identity", "provider", providerID, "err", err)
		detail, _ := json.Marshal(map[string]string{"provider": providerID, "error": err.Error()})
		if err := s.q.Audit(ctx, sqlc.AuditParams{Event: "external_identity.revoke_failed",
			Sub: pgtype.Text{String: userID, Valid: true}, Detail: detail}); err != nil {
			slog.Error("audit", "err", err)
		}
	}
	return nil
}

// unlink tells the Provider, enabled or not, that gone is unbound.
func (s *Store) unlink(ctx context.Context, id string, gone sqlc.DeleteExternalIdentityRow) error {
	p, err := s.build(ctx, id, false)
	if err != nil {
		return err
	}
	u, ok := p.(Unlinker)
	if !ok {
		return nil
	}
	var token []byte
	if gone.Token != nil {
		if token, err = s.keyring.Open(gone.Token, tokenAAD(id, gone.Subject)); err != nil {
			return err
		}
	}
	return u.Unlink(ctx, string(token))
}
