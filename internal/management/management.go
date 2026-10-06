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
	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/channel"
	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/oidcstore"
)

// Prefix is where the Management API lives; its OpenAPI document is at
// Prefix + "/openapi.json".
const Prefix = "/v1/management"

type Service struct {
	issuer   string
	q        *sqlc.Queries
	keys     *oidcstore.Keys
	channels *channel.Store
}

func New(pool *pgxpool.Pool, keyring *crypt.Keyring, issuer string) *Service {
	return &Service{issuer: issuer, q: sqlc.New(pool), keys: oidcstore.NewKeys(pool, keyring), channels: channel.NewStore(pool, keyring)}
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
	get(api, "list-roles", "users:read", "/roles", "All Roles, for the Role filter", s.listRoles)

	get(api, "list-channels", "config:read", "/channels", "Channel plugins and the enabled Channel of each Identifier kind", s.listChannels)
	op(api, http.MethodPut, "put-channel", "config:write", "/channels/{kind}", "Enable and configure the Channel of an Identifier kind", s.putChannel)
	op(api, http.MethodDelete, "delete-channel", "config:write", "/channels/{kind}", "Turn off codes of an Identifier kind", s.deleteChannel)
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
		sub, err := s.verify(ctx.Context(), ctx.Header("Authorization"))
		if err != nil {
			ctx.SetHeader("WWW-Authenticate", `Bearer error="invalid_token"`)
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "access token missing or invalid")
			return
		}
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
	}
}

var errToken = errors.New("invalid access token")

// verify checks an RFC 9068 access token for the Management API and returns
// its sub.
func (s *Service) verify(ctx context.Context, header string) (string, error) {
	raw, ok := strings.CutPrefix(header, "Bearer ")
	if !ok {
		return "", errToken
	}
	tok, err := jwt.ParseSigned(raw, []jose.SignatureAlgorithm{jose.RS256})
	if err != nil {
		return "", errToken
	}
	// typ keeps ID tokens, signed by the same key, out.
	typ, _ := tok.Headers[0].ExtraHeaders[jose.HeaderType].(string)
	if !strings.EqualFold(strings.TrimPrefix(typ, "application/"), "at+jwt") {
		return "", errToken
	}
	jwks, err := s.keys.JWKS(ctx)
	if err != nil {
		return "", err
	}
	set := jose.JSONWebKeySet{Keys: jwks.Keys}
	keys := set.Key(tok.Headers[0].KeyID)
	if len(keys) == 0 {
		return "", errToken
	}
	var c jwt.Claims
	if err := tok.Claims(keys[0].Public().Key, &c); err != nil {
		return "", errToken
	}
	if err := c.ValidateWithLeeway(jwt.Expected{
		Issuer:      s.issuer,
		AnyAudience: jwt.Audience{identity.ManagementAPI},
		Time:        time.Now(),
	}, 0); err != nil || c.Expiry == nil || c.Subject == "" {
		return "", errToken
	}
	return c.Subject, nil
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
	Identifiers []Identifier `json:"identifiers"`
	Roles       []Role       `json:"roles"`
}

type UserDetail struct {
	User
	HasPassword bool `json:"hasPassword"`
}

type meOutput struct {
	Body struct {
		Sub         string   `json:"sub"`
		Permissions []string `json:"permissions"`
	}
}

func (s *Service) me(ctx context.Context, _ *struct{}) (*meOutput, error) {
	c := ctx.Value(callerKey{}).(caller)
	out := &meOutput{}
	out.Body.Sub, out.Body.Permissions = c.sub, c.permissions
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
		u, err := user(r.ID, r.CreatedAt.Time, r.Identifiers, r.Roles)
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
	u, err := user(r.ID, r.CreatedAt.Time, r.Identifiers, r.Roles)
	if err != nil {
		return nil, err
	}
	return &getUserOutput{Body: UserDetail{User: u, HasPassword: r.HasPassword}}, nil
}

func user(sub string, created time.Time, identifiers, roles []byte) (User, error) {
	u := User{Sub: sub, CreatedAt: created}
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
