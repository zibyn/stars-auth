package management

import (
	"context"
	"errors"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/twofactor"
)

type subPath struct {
	Sub string `path:"sub"`
}

// mayManage checks that the caller may act on sub: acting on an admin
// needs admin-roles:assign, as making one does.
func (s *Service) mayManage(ctx context.Context, sub string) error {
	u, err := s.q.GetUser(ctx, sub)
	if errors.Is(err, pgx.ErrNoRows) {
		return huma.Error404NotFound("no such User")
	} else if err != nil {
		return err
	}
	target, err := user(u.ID, u.CreatedAt.Time, u.DisabledAt, u.Identifiers, u.Roles)
	if err != nil {
		return err
	}
	for _, r := range target.Roles {
		if r.API == identity.ManagementAPI {
			return mayMakeAdmins(ctx)
		}
	}
	return nil
}

// ownersGuard runs change in a transaction that fails with 409 if it leaves
// no enabled owner.
func (s *Service) ownersGuard(ctx context.Context, change func(*sqlc.Queries) (int64, error)) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.LockOwners(ctx); err != nil {
			return err
		}
		if _, err := change(q); err != nil {
			return err
		}
		if n, err := q.CountOwners(ctx); err != nil {
			return err
		} else if n == 0 {
			return huma.Error409Conflict("不能禁用或删除最后一个所有者")
		}
		return nil
	})
}

func (s *Service) disableUser(ctx context.Context, in *subPath) (*struct{}, error) {
	return nil, s.setDisabled(ctx, in.Sub, true)
}

func (s *Service) enableUser(ctx context.Context, in *subPath) (*struct{}, error) {
	return nil, s.setDisabled(ctx, in.Sub, false)
}

func (s *Service) setDisabled(ctx context.Context, sub string, disabled bool) error {
	if err := s.mayManage(ctx, sub); err != nil {
		return err
	}
	return s.ownersGuard(ctx, func(q *sqlc.Queries) (int64, error) {
		return q.SetUserDisabled(ctx, sqlc.SetUserDisabledParams{UserID: sub, Disabled: disabled, By: callerSub(ctx)})
	})
}

// deleteUser removes the User and all their data; only audit events keep
// the sub (docs/spec/security-compliance.md#数据留存).
func (s *Service) deleteUser(ctx context.Context, in *subPath) (*struct{}, error) {
	if err := s.mayManage(ctx, in.Sub); err != nil {
		return nil, err
	}
	return nil, s.ownersGuard(ctx, func(q *sqlc.Queries) (int64, error) {
		return q.DeleteUser(ctx, sqlc.DeleteUserParams{UserID: in.Sub, By: callerSub(ctx)})
	})
}

type replaceIdentifierInput struct {
	Sub  string `path:"sub"`
	Kind string `path:"kind" enum:"phone,email,username"`
	Body struct {
		Value string `json:"value" doc:"+86 phone number, email or username; normalised"`
	}
}

func (s *Service) replaceIdentifier(ctx context.Context, in *replaceIdentifierInput) (*struct{}, error) {
	if err := s.mayManage(ctx, in.Sub); err != nil {
		return nil, err
	}
	var value string
	var err error
	if in.Kind == "username" {
		value, err = identity.CheckUsername(in.Body.Value)
	} else {
		var kind string
		kind, value, err = identity.ParseIdentifier(in.Body.Value)
		if err == nil && kind != in.Kind {
			err = identity.ErrIdentifier
		}
	}
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	_, err = s.q.ReplaceIdentifier(ctx, sqlc.ReplaceIdentifierParams{UserID: in.Sub, Kind: in.Kind, Value: value, By: callerSub(ctx)})
	if isUniqueViolation(err) {
		return nil, huma.Error409Conflict(identity.ErrIdentifierTaken.Error())
	}
	return nil, err
}

// resetTwoFactor is for a User who lost both their authenticator and 恢复码;
// the admin checked who they are offline.
func (s *Service) resetTwoFactor(ctx context.Context, in *subPath) (*struct{}, error) {
	if err := s.mayManage(ctx, in.Sub); err != nil {
		return nil, err
	}
	err := s.mfa.Disable(ctx, in.Sub, "mfa.reset", callerSub(ctx))
	if errors.Is(err, twofactor.ErrOff) || errors.Is(err, twofactor.ErrNotBegun) {
		return nil, huma.Error409Conflict("该 User 未开启两步验证")
	}
	return nil, err
}

func callerSub(ctx context.Context) string { return ctx.Value(callerKey{}).(caller).sub }
