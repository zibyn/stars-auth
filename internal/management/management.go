// Package management serves the Management API: REST endpoints for admins,
// authorized live against the caller's Roles on every request.
package management

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/channel"
	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidcstore"
	"github.com/zibyn/stars-auth/internal/twofactor"
)

// Prefix is where the Management API lives; its OpenAPI document is at
// Prefix + "/openapi.json".
const Prefix = "/v1/management"

type Service struct {
	issuer   string
	pool     *pgxpool.Pool
	keyring  *crypt.Keyring
	q        *sqlc.Queries
	keys     *oidcstore.Keys
	channels *channel.Store
	mfa      *twofactor.Store
}

func New(pool *pgxpool.Pool, keyring *crypt.Keyring, issuer string) *Service {
	return &Service{issuer: issuer, pool: pool, keyring: keyring, q: sqlc.New(pool), keys: oidcstore.NewKeys(pool, keyring), channels: channel.NewStore(pool, keyring), mfa: twofactor.New(pool, keyring)}
}

type callerKey struct{}

// caller is who a request comes from and what they may do, read fresh from
// PG for this request.
type caller struct {
	sub         string
	permissions []string
}

// Register adds the Management API and its OpenAPI document to mux.
func (s *Service) Register(mux *http.ServeMux) {
	cfg := huma.DefaultConfig("Stars Auth Management API", "1")
	cfg.DocsPath = ""
	cfg.SchemasPath = ""
	cfg.CreateHooks = nil // no $schema links in bodies
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {Type: "http", Scheme: "bearer", BearerFormat: "JWT",
			Description: "Access token whose aud is " + identity.ManagementAPI},
	}
	cfg.Security = []map[string][]string{{"bearer": {}}}
	api := humago.NewWithPrefix(mux, Prefix, cfg)
	api.UseMiddleware(s.authorize(api))

	get(api, "me", "", "/me", "The caller and their Permissions", s.me)
	get(api, "list-users", "users:read", "/users", "Search Users", s.listUsers)
	get(api, "get-user", "users:read", "/users/{sub}", "A User's details", s.getUser)
	// Role names show in the Users list, so reading them needs no more than users:read.
	get(api, "list-sessions", "users:read", "/users/{sub}/sessions", "A User's Sessions", s.listSessions)
	op(api, http.MethodDelete, "end-session", "users:write", "/users/{sub}/sessions/{id}", "Sign a User out of one Session", s.endSession)
	// Acting on an admin further needs admin-roles:assign.
	op(api, http.MethodPost, "disable-user", "users:write", "/users/{sub}/disable", "Disable a User: no logins, every Session ended", s.disableUser, http.StatusConflict)
	op(api, http.MethodPost, "enable-user", "users:write", "/users/{sub}/enable", "Restore a disabled User", s.enableUser, http.StatusConflict)
	op(api, http.MethodDelete, "delete-user", "users:write", "/users/{sub}", "Delete a User and all their data", s.deleteUser, http.StatusConflict)
	op(api, http.MethodDelete, "reset-two-factor", "users:write", "/users/{sub}/2fa", "Reset a User's 两步验证: their TOTP and 恢复码 go, their Sessions stay", s.resetTwoFactor, http.StatusConflict)
	op(api, http.MethodPut, "replace-identifier", "users:write", "/users/{sub}/identifiers/{kind}", "Set a User's Identifier of a kind, replacing theirs", s.replaceIdentifier, http.StatusConflict)
	get(api, "overview", "users:read", "/overview", "Counts for the console's overview", s.overview)
	get(api, "list-audit", "audit:read", "/audit", "Search the audit log", s.listAudit)
	get(api, "list-roles", "users:read", "/roles", "All Roles, for the Role filter", s.listRoles)
	// Management API Roles further need admin-roles:assign.
	get(api, "list-apis", "applications:read", "/apis", "APIs with their Permissions and Roles", s.listAPIs)
	op(api, http.MethodPut, "put-api", "applications:write", "/apis/{api}", "Register an API or rename it", s.putAPI, http.StatusConflict)
	op(api, http.MethodDelete, "delete-api", "applications:write", "/apis/{api}", "Delete an API with its Permissions and Roles", s.deleteAPI, http.StatusConflict)
	op(api, http.MethodPut, "put-permission", "applications:write", "/apis/{api}/permissions/{key}", "Define a Permission or rename it", s.putPermission, http.StatusConflict)
	op(api, http.MethodDelete, "delete-permission", "applications:write", "/apis/{api}/permissions/{key}", "Delete a Permission; Roles lose it too", s.deletePermission, http.StatusConflict)
	op(api, http.MethodPut, "put-role", "applications:write", "/apis/{api}/roles/{key}", "Define a Role or change its name and Permissions", s.putRole, http.StatusConflict)
	op(api, http.MethodDelete, "delete-role", "applications:write", "/apis/{api}/roles/{key}", "Delete a Role", s.deleteRole, http.StatusConflict)
	get(api, "list-applications", "applications:read", "/applications", "All Applications", s.listApplications)
	get(api, "get-application", "applications:read", "/applications/{clientId}", "An Application", s.getApplication)
	op(api, http.MethodPost, "create-application", "applications:write", "/applications", "Register an Application", s.createApplication)
	op(api, http.MethodPut, "update-application", "applications:write", "/applications/{clientId}", "Change an Application's settings", s.updateApplication, http.StatusConflict)
	op(api, http.MethodDelete, "delete-application", "applications:write", "/applications/{clientId}", "Delete an Application", s.deleteApplication, http.StatusConflict)
	op(api, http.MethodPost, "new-application-secret", "applications:write", "/applications/{clientId}/secret", "Replace a confidential Application's client secret", s.newSecret, http.StatusConflict)
	op(api, http.MethodPut, "set-user-roles", "roles:assign", "/users/{sub}/roles", "Set a User's Roles on one API", s.setUserRoles, http.StatusConflict)

	get(api, "list-channels", "config:read", "/channels", "Channel plugins and the enabled Channel of each Identifier kind", s.listChannels)
	op(api, http.MethodPut, "put-channel", "config:write", "/channels/{kind}", "Enable and configure the Channel of an Identifier kind", s.putChannel)
	op(api, http.MethodDelete, "delete-channel", "config:write", "/channels/{kind}", "Turn off codes of an Identifier kind", s.deleteChannel)
	get(api, "get-settings", "config:read", "/settings", "The login policy", s.getSettings)
	op(api, http.MethodPut, "put-settings", "config:write", "/settings", "Change the login policy", s.putSettings)
	get(api, "list-signing-keys", "config:read", "/signing-keys", "The token signing keys", s.listKeys)
	op(api, http.MethodPost, "rotate-signing-keys", "keys:rotate", "/signing-keys/rotate", "Make a new signing key current; the oldest is retired", s.rotateKeys)
	op(api, http.MethodPost, "test-channel", "config:write", "/channels/{kind}/test", "Send a test code through the enabled Channel", s.testChannel, http.StatusBadGateway)
}

// get registers a GET operation that needs permission ("" for any admin).
func get[I, O any](api huma.API, id, permission, path, summary string, h func(context.Context, *I) (*O, error)) {
	op(api, http.MethodGet, id, permission, path, summary, h)
}

// op registers an operation that needs permission ("" for any admin).
func op[I, O any](api huma.API, method, id, permission, path, summary string, h func(context.Context, *I) (*O, error), errs ...int) {
	errs = append(errs, http.StatusUnauthorized, http.StatusForbidden)
	if strings.Contains(path, "{") { // names a resource that may not exist
		errs = append(errs, http.StatusNotFound)
	}
	if method != http.MethodGet {
		errs = append(errs, http.StatusUnprocessableEntity)
	}
	huma.Register(api, huma.Operation{
		OperationID: id,
		Method:      method,
		Path:        path,
		Summary:     summary,
		Description: describe(permission),
		Errors:      errs,
		Metadata:    map[string]any{"permission": permission},
	}, h)
}

func describe(permission string) string {
	if permission == "" {
		return "Needs any Management API Role."
	}
	return "Needs `" + permission + "`."
}

// authorize checks the bearer token, then the caller's Permissions as they
// stand in PG now: taking a Role away locks the admin out on the next
// request, not when the token expires.
func (s *Service) authorize(api huma.API) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		tok, err := s.keys.Verify(ctx.Context(), s.issuer, identity.ManagementAPI, ctx.Header("Authorization"))
		if err != nil {
			ctx.SetHeader("WWW-Authenticate", `Bearer error="invalid_token"`)
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "access token missing or invalid")
			return
		}
		sub := tok.Subject
		c, err := s.q.Caller(ctx.Context(), sqlc.CallerParams{UserID: sub, Api: identity.ManagementAPI})
		if err != nil {
			_ = huma.WriteErr(api, ctx, http.StatusInternalServerError, "internal error")
			return
		}
		want, _ := ctx.Operation().Metadata["permission"].(string)
		if !c.Admin {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "not an admin")
			return
		}
		if want != "" && !slices.Contains(c.Permissions, want) {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "missing permission "+want)
			return
		}
		next(huma.WithValue(ctx, callerKey{}, caller{sub: sub, permissions: c.Permissions}))
		s.auditWrite(ctx, sub)
	}
}

type Identifier struct {
	Kind  string `json:"kind" enum:"phone,email,username"`
	Value string `json:"value"`
}

type Role struct {
	API  string `json:"api" doc:"Identifier of the API the Role is on"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type User struct {
	Sub         string       `json:"sub"`
	CreatedAt   time.Time    `json:"createdAt"`
	DisabledAt  *time.Time   `json:"disabledAt,omitempty" doc:"Set while the User is disabled"`
	Identifiers []Identifier `json:"identifiers"`
	Roles       []Role       `json:"roles"`
}

type UserDetail struct {
	User
	HasPassword bool `json:"hasPassword"`
	TwoFactor   bool `json:"twoFactor" doc:"两步验证 is on"`
}

type meOutput struct {
	Body struct {
		Sub         string   `json:"sub"`
		Identifier  string   `json:"identifier" doc:"The caller's primary Identifier: phone, else email, else username"`
		Permissions []string `json:"permissions"`
	}
}

func (s *Service) me(ctx context.Context, _ *struct{}) (*meOutput, error) {
	c := ctx.Value(callerKey{}).(caller)
	out := &meOutput{}
	out.Body.Sub, out.Body.Permissions = c.sub, c.permissions
	r, err := s.q.GetUser(ctx, c.sub)
	if err != nil {
		return nil, err
	}
	u, err := user(r.ID, r.CreatedAt.Time, r.DisabledAt, r.Identifiers, r.Roles)
	if err != nil {
		return nil, err
	}
	for _, kind := range []string{"phone", "email", "username"} {
		if i := slices.IndexFunc(u.Identifiers, func(i Identifier) bool { return i.Kind == kind }); i >= 0 {
			out.Body.Identifier = u.Identifiers[i].Value
			break
		}
	}
	return out, nil
}

type listUsersInput struct {
	Q      string `query:"q" doc:"Part of a sub, phone number, email or username"`
	Role   string `query:"role" doc:"Only Users holding this Role"`
	API    string `query:"api" doc:"API of the Role filter; defaults to the Management API"`
	Limit  int32  `query:"limit" default:"50" minimum:"1" maximum:"200"`
	Offset int32  `query:"offset" minimum:"0"`
}

type listUsersOutput struct {
	Body struct {
		Users   []User `json:"users" nullable:"false"`
		HasMore bool   `json:"hasMore"`
	}
}

func (s *Service) listUsers(ctx context.Context, in *listUsersInput) (*listUsersOutput, error) {
	api := in.API
	if api == "" {
		api = identity.ManagementAPI
	}
	rows, err := s.q.ListUsers(ctx, sqlc.ListUsersParams{
		Search: strings.TrimSpace(in.Q), Role: in.Role, Api: api, Lim: in.Limit + 1, Off: in.Offset,
	})
	if err != nil {
		return nil, err
	}
	out := &listUsersOutput{}
	out.Body.Users = []User{}
	for i, r := range rows {
		if i == int(in.Limit) {
			out.Body.HasMore = true
			break
		}
		u, err := user(r.ID, r.CreatedAt.Time, r.DisabledAt, r.Identifiers, r.Roles)
		if err != nil {
			return nil, err
		}
		out.Body.Users = append(out.Body.Users, u)
	}
	return out, nil
}

type getUserOutput struct{ Body UserDetail }

func (s *Service) getUser(ctx context.Context, in *struct {
	Sub string `path:"sub"`
}) (*getUserOutput, error) {
	r, err := s.q.GetUser(ctx, in.Sub)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, huma.Error404NotFound("no such User")
	} else if err != nil {
		return nil, err
	}
	u, err := user(r.ID, r.CreatedAt.Time, r.DisabledAt, r.Identifiers, r.Roles)
	if err != nil {
		return nil, err
	}
	return &getUserOutput{Body: UserDetail{User: u, HasPassword: r.HasPassword, TwoFactor: r.TwoFactor}}, nil
}

func user(sub string, created time.Time, disabled pgtype.Timestamptz, identifiers, roles []byte) (User, error) {
	u := User{Sub: sub, CreatedAt: created}
	if disabled.Valid {
		u.DisabledAt = &disabled.Time
	}
	if err := json.Unmarshal(identifiers, &u.Identifiers); err != nil {
		return u, err
	}
	return u, json.Unmarshal(roles, &u.Roles)
}

type RoleInfo struct {
	Role
	APIName string `json:"apiName"`
	Builtin bool   `json:"builtin" doc:"Built-in Roles cannot be changed or deleted"`
}

type listRolesOutput struct {
	Body struct {
		Roles []RoleInfo `json:"roles" nullable:"false"`
	}
}

func (s *Service) listRoles(ctx context.Context, _ *struct{}) (*listRolesOutput, error) {
	rows, err := s.q.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	out := &listRolesOutput{}
	out.Body.Roles = []RoleInfo{}
	for _, r := range rows {
		out.Body.Roles = append(out.Body.Roles, RoleInfo{Role: Role{API: r.Api, Key: r.Key, Name: r.Name}, APIName: r.ApiName, Builtin: r.Builtin})
	}
	return out, nil
}
