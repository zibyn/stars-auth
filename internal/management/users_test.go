package management_test

import (
	"context"
	"net/url"
	"strconv"
	"testing"
	"time"
)

type auditEvent struct {
	ID     int64
	At     time.Time
	Event  string
	Sub    string
	User   string
	ByUser string
	Detail map[string]any
}

// events reads the audit log through the API, newest first.
func (e *env) events(query string) []auditEvent {
	e.t.Helper()
	var out struct{ Events []auditEvent }
	if code := e.get(e.token(e.owner, nil), "/audit?"+query, &out); code != 200 {
		e.t.Fatalf("audit: %d", code)
	}
	return out.Events
}

// audited returns the newest event named event, failing if there is none.
func (e *env) audited(event string) auditEvent {
	e.t.Helper()
	got := e.events("event=" + url.QueryEscape(event))
	if len(got) == 0 {
		e.t.Fatalf("no %s event", event)
	}
	return got[0]
}

func TestAuditShowsWhoByTheirPrimaryIdentifier(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil, "username:alice", "email:alice@example.com", "phone:+8613800000001")
	owner := e.token(e.owner, nil)

	e.call("POST", owner, "/users/ALICE/disable", nil, nil)
	if ev := e.audited("user.disabled"); ev.User != "+8613800000001" || ev.ByUser != "owner" {
		t.Errorf("phone comes first, then the admin's username: %+v", ev)
	}
	e.call("POST", owner, "/signing-keys/rotate", nil, nil)
	if ev := e.audited("keys.rotated"); ev.User != "" || ev.ByUser != "owner" {
		t.Errorf("no User: %+v", ev)
	}
	e.call("DELETE", owner, "/users/ALICE", nil, nil)
	if ev := e.audited("user.deleted"); ev.User != "" || ev.Sub != "ALICE" {
		t.Errorf("deleted User: %+v", ev)
	}
}

func TestAdminDisablesAndRestoresAUser(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil, "email:alice@example.com")
	e.user("RO", []string{"readonly"})
	owner, ro := e.token(e.owner, nil), e.token("RO", nil)
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO sessions (user_id, auth_time, amr) VALUES ('ALICE', now(), '{pwd}'), ('ALICE', now(), '{sms}')`); err != nil {
		t.Fatal(err)
	}

	if code := e.call("POST", ro, "/users/ALICE/disable", nil, nil); code != 403 {
		t.Errorf("readonly: %d", code)
	}
	if code := e.call("POST", owner, "/users/NOPE/disable", nil, nil); code != 404 {
		t.Errorf("unknown User: %d", code)
	}
	if code := e.call("POST", owner, "/users/ALICE/disable", nil, nil); code != 204 {
		t.Fatalf("disable: %d", code)
	}
	var u struct{ DisabledAt *time.Time }
	if e.get(owner, "/users/ALICE", &u); u.DisabledAt == nil {
		t.Error("detail does not show disabled")
	}
	var sessions struct{ Sessions []struct{ Active bool } }
	e.get(owner, "/users/ALICE/sessions", &sessions)
	for _, s := range sessions.Sessions {
		if s.Active {
			t.Error("a Session survived disabling")
		}
	}
	if ev := e.audited("user.disabled"); ev.Sub != "ALICE" || ev.Detail["by"] != e.owner {
		t.Errorf("audit: %+v", ev)
	}

	if code := e.call("POST", owner, "/users/ALICE/enable", nil, nil); code != 204 {
		t.Fatalf("enable: %d", code)
	}
	u.DisabledAt = nil
	if e.get(owner, "/users/ALICE", &u); u.DisabledAt != nil {
		t.Error("still disabled")
	}
	if ev := e.audited("user.enabled"); ev.Sub != "ALICE" {
		t.Errorf("audit: %+v", ev)
	}

	// Acting on an admin takes admin-roles:assign, which admins lack.
	e.user("ADMIN", []string{"admin"})
	admin := e.token("ADMIN", nil)
	if code := e.call("POST", admin, "/users/RO/disable", nil, nil); code != 403 {
		t.Errorf("admin disables an admin: %d", code)
	}
	if code := e.call("PUT", admin, "/users/RO/identifiers/email", map[string]string{"value": "ro@example.com"}, nil); code != 403 {
		t.Errorf("admin replaces an admin's email: %d", code)
	}
	if code := e.call("POST", admin, "/users/ALICE/disable", nil, nil); code != 204 {
		t.Errorf("admin disables a User: %d", code)
	}

	// A disabled admin is no admin, even with a valid token.
	e.call("POST", owner, "/users/RO/disable", nil, nil)
	if code := e.get(ro, "/users", nil); code != 403 {
		t.Errorf("disabled admin: %d", code)
	}
}

func TestLastOwnerCannotBeDisabledOrDeleted(t *testing.T) {
	e := start(t)
	e.user("OWNER2", []string{"owner"})
	owner := e.token(e.owner, nil)

	if code := e.call("POST", owner, "/users/OWNER2/disable", nil, nil); code != 204 {
		t.Fatalf("disable one of two owners: %d", code)
	}
	// A disabled owner does not count.
	for _, op := range []struct{ method, path string }{
		{"POST", "/users/" + e.owner + "/disable"},
		{"DELETE", "/users/" + e.owner},
	} {
		if code := e.call(op.method, owner, op.path, nil, nil); code != 409 {
			t.Errorf("%s %s: %d, want 409", op.method, op.path, code)
		}
	}
	if code := e.call("PUT", owner, "/users/"+e.owner+"/roles", map[string]any{"api": "urn:stars-auth:management-api", "roles": []string{"admin"}}, nil); code != 409 {
		t.Errorf("step down while the other owner is disabled: %d", code)
	}
}

func TestAdminDeletesAUser(t *testing.T) {
	e := start(t)
	e.user("ALICE", []string{"readonly"}, "email:alice@example.com")
	owner := e.token(e.owner, nil)

	if code := e.call("DELETE", owner, "/users/ALICE", nil, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code := e.get(owner, "/users/ALICE", nil); code != 404 {
		t.Errorf("after delete: %d", code)
	}
	if code := e.call("DELETE", owner, "/users/ALICE", nil, nil); code != 404 {
		t.Errorf("delete again: %d", code)
	}
	// The Identifier is free again.
	e.user("ALICE2", nil, "email:alice@example.com")
	if ev := e.audited("user.deleted"); ev.Sub != "ALICE" || ev.Detail["by"] != e.owner {
		t.Errorf("audit: %+v", ev)
	}
}

func TestAdminReplacesAnIdentifier(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil, "email:alice@example.com")
	e.user("BOB", nil, "phone:+8613800002222")
	owner := e.token(e.owner, nil)
	put := func(sub, kind, value string) int {
		return e.call("PUT", owner, "/users/"+sub+"/identifiers/"+kind, map[string]string{"value": value}, nil)
	}

	if code := put("ALICE", "email", "  Alice@New.example "); code != 204 {
		t.Fatalf("replace email: %d", code)
	}
	if code := put("ALICE", "phone", "138 0000 1111"); code != 204 {
		t.Fatalf("add phone: %d", code)
	}
	if code := put("ALICE", "username", "Alice"); code != 204 {
		t.Fatalf("add username: %d", code)
	}
	var u user
	e.get(owner, "/users/ALICE", &u)
	want := map[string]string{"email": "alice@new.example", "phone": "+8613800001111", "username": "alice"}
	if len(u.Identifiers) != 3 {
		t.Errorf("identifiers: %+v", u.Identifiers)
	}
	for _, id := range u.Identifiers {
		if want[id.Kind] != id.Value {
			t.Errorf("%s = %q, want %q", id.Kind, id.Value, want[id.Kind])
		}
	}

	for name, tc := range map[string]struct {
		sub, kind, value string
		want             int
	}{
		"another User's": {"ALICE", "phone", "+8613800002222", 409},
		"not an email":   {"ALICE", "email", "nope", 422},
		"phone as email": {"ALICE", "email", "13800003333", 422},
		"bad username":   {"ALICE", "username", "a@b", 422},
		"unknown kind":   {"ALICE", "fax", "1", 422},
		"unknown User":   {"NOPE", "email", "x@example.com", 404},
	} {
		if code := put(tc.sub, tc.kind, tc.value); code != tc.want {
			t.Errorf("%s: %d, want %d", name, code, tc.want)
		}
	}
	// The audit names the kind, never the values.
	if ev := e.audited("identifier.replaced"); ev.Sub != "ALICE" || ev.Detail["kind"] != "username" || ev.Detail["by"] != e.owner || len(ev.Detail) != 2 {
		t.Errorf("audit: %+v", ev)
	}
}

// Every Management API write is audited, with who did it; reads are not.
func TestEveryWriteIsAudited(t *testing.T) {
	e := start(t)
	owner := e.token(e.owner, nil)
	if code := e.call("PUT", owner, "/apis/https%3A%2F%2Fapi.example", map[string]string{"name": "Example"}, nil); code != 204 {
		t.Fatalf("put api: %d", code)
	}
	if code := e.call("DELETE", owner, "/apis/https%3A%2F%2Fapi.example", nil, nil); code != 204 {
		t.Fatalf("delete api: %d", code)
	}
	if code := e.call("DELETE", owner, "/apis/https%3A%2F%2Fnone.example", nil, nil); code != 404 {
		t.Fatalf("delete unknown api: %d", code)
	}
	e.get(owner, "/apis", nil)

	got := e.events("")
	if len(got) != 2 || got[0].Event != "delete-api" || got[1].Event != "put-api" {
		t.Fatalf("events: %+v", got)
	}
	if d := got[0].Detail; d["by"] != e.owner || d["api"] != "https://api.example" {
		t.Errorf("detail: %+v", d)
	}
	// Self-audited writes are not audited twice.
	e.call("POST", owner, "/signing-keys/rotate", nil, nil)
	if got := e.events(""); len(got) != 3 || got[0].Event != "keys.rotated" {
		t.Errorf("after rotate: %+v", got)
	}
}

func TestAuditFilters(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil)
	e.user("BOB", nil)
	e.user("RO", []string{"readonly"})
	e.user("NOAUDIT", []string{"admin"})
	if _, err := e.pool.Exec(context.Background(), `
		DELETE FROM role_permissions WHERE role = 'admin' AND permission = 'audit:read';
		INSERT INTO audit_log (event, sub, detail, at) VALUES
			('user.disabled', 'ALICE', '{"by": "RO"}', now() - interval '2 days'),
			('user.disabled', 'BOB', '{"by": "RO"}', now() - interval '1 day'),
			('user.enabled', 'BOB', '{}', now())`); err != nil {
		t.Fatal(err)
	}
	if code := e.get(e.token("NOAUDIT", nil), "/audit", nil); code != 403 {
		t.Errorf("without audit:read: %d", code)
	}
	if code := e.get(e.token("RO", nil), "/audit", nil); code != 200 {
		t.Errorf("readonly: %d", code)
	}
	since := url.QueryEscape(time.Now().Add(-36 * time.Hour).Format(time.RFC3339))
	for query, want := range map[string][]string{
		"":                          {"user.enabled", "user.disabled", "user.disabled"},
		"event=user.disabled":       {"user.disabled", "user.disabled"},
		"sub=BOB":                   {"user.enabled", "user.disabled"},
		"sub=RO":                    {"user.disabled", "user.disabled"}, // who did it
		"since=" + since:            {"user.enabled", "user.disabled"},
		"until=" + since:            {"user.disabled"},
		"limit=1":                   {"user.enabled"},
		"event=user.disabled&sub=X": nil,
	} {
		got := e.events(query)
		var events []string
		for _, ev := range got {
			events = append(events, ev.Event)
		}
		if len(events) != len(want) {
			t.Errorf("%q: %v, want %v", query, events, want)
			continue
		}
		for i := range want {
			if events[i] != want[i] {
				t.Errorf("%q: %v, want %v", query, events, want)
			}
		}
	}
	// Paging: before the oldest of the first page.
	first := e.events("limit=2")
	if rest := e.events("limit=2&before=" + strconv.FormatInt(first[1].ID, 10)); len(rest) != 1 || rest[0].Sub != "ALICE" {
		t.Errorf("second page: %+v", rest)
	}
}

func TestOverview(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil)
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO sessions (user_id, auth_time, amr) VALUES ('ALICE', now(), '{pwd}');
		INSERT INTO sessions (user_id, auth_time, amr, ended_at) VALUES ('ALICE', now() - interval '3 days', '{pwd}', now())`); err != nil {
		t.Fatal(err)
	}
	var o struct {
		Users, LoginsToday, LiveSessions, Applications, SendsLastDay, DailySendLimit int
	}
	if code := e.get(e.token(e.owner, nil), "/overview", &o); code != 200 ||
		o.Users != 2 || o.LoginsToday != 1 || o.LiveSessions != 1 || o.Applications != 2 || o.DailySendLimit != 1000 {
		t.Errorf("overview: %d %+v", code, o)
	}
}

// The writes that audit themselves.
func TestSelfAuditedWrites(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil)
	owner := e.token(e.owner, nil)
	var id string
	if err := e.pool.QueryRow(context.Background(),
		"INSERT INTO sessions (user_id, auth_time, amr) VALUES ('ALICE', now(), '{pwd}') RETURNING id").Scan(&id); err != nil {
		t.Fatal(err)
	}
	if code := e.call("DELETE", owner, "/users/ALICE/sessions/"+id, nil, nil); code != 204 {
		t.Fatalf("end session: %d", code)
	}
	if ev := e.audited("session.ended"); ev.Sub != "ALICE" || ev.Detail["session"] != id || ev.Detail["by"] != e.owner {
		t.Errorf("session.ended: %+v", ev)
	}

	if code := e.call("PUT", owner, "/users/ALICE/roles", map[string]any{"api": "urn:stars-auth:management-api", "roles": []string{"readonly"}}, nil); code != 204 {
		t.Fatalf("roles: %d", code)
	}
	if ev := e.audited("roles.assigned"); ev.Sub != "ALICE" || ev.Detail["by"] != e.owner {
		t.Errorf("roles.assigned: %+v", ev)
	}

	if code := e.call("PUT", owner, "/settings", settings{PasswordLogin: "all", DailySendLimit: 1, AuditRetentionDays: 1}, nil); code != 204 {
		t.Fatalf("settings: %d", code)
	}
	if ev := e.audited("settings.updated"); ev.Detail["by"] != e.owner {
		t.Errorf("settings.updated: %+v", ev)
	}
	if got := e.events(""); len(got) != 3 {
		t.Errorf("audited twice: %+v", got)
	}
}
