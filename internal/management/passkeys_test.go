package management_test

import (
	"context"
	"testing"
	"time"
)

// passkey inserts a Passkey row for sub, as if added from the account
// center; used says whether it has signed in once.
func (e *env) passkey(sub, name string, used bool) string {
	e.t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(), `
		INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, aaguid,
		                      backup_eligible, backup_state, name, last_used_at)
		VALUES ($1, decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), '\x00'::bytea, 0, gen_random_uuid(),
		        true, true, $2, CASE WHEN $3 THEN now() END)
		RETURNING id`, sub, name, used).Scan(&id)
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

// An admin lists and deletes a User's Passkeys from the user's detail; the
// read-only Role sees them too but cannot delete.
func TestAdminManagesUserPasskeys(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil, "email:alice@example.com")
	e.user("READER", []string{"readonly"})
	owner := e.token(e.owner, nil)
	ro := e.token("READER", nil)

	laptop := e.passkey("ALICE", "工作电脑", true)
	e.passkey("ALICE", "Passkey", false)

	var list struct {
		Passkeys []struct {
			ID         string
			Name       string
			CreatedAt  time.Time
			LastUsedAt *time.Time
		} `json:"passkeys"`
	}
	if code := e.get(owner, "/users/ALICE/passkeys", &list); code != 200 || len(list.Passkeys) != 2 ||
		list.Passkeys[0].ID != laptop || list.Passkeys[0].Name != "工作电脑" ||
		list.Passkeys[0].LastUsedAt == nil || list.Passkeys[0].CreatedAt.IsZero() ||
		list.Passkeys[1].Name != "Passkey" || list.Passkeys[1].LastUsedAt != nil {
		t.Fatalf("list: %d %+v", code, list)
	}
	if code := e.get(ro, "/users/ALICE/passkeys", &list); code != 200 || len(list.Passkeys) != 2 {
		t.Errorf("readonly lists: %d %+v", code, list)
	}
	if code := e.get(owner, "/users/NOPE/passkeys", &list); code != 404 {
		t.Errorf("unknown User: %d", code)
	}

	if code := e.call("DELETE", ro, "/users/ALICE/passkeys/"+laptop, nil, nil); code != 403 {
		t.Fatalf("readonly deletes: %d, want 403", code)
	}
	if code := e.call("DELETE", owner, "/users/ALICE/passkeys/"+laptop, nil, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code := e.get(owner, "/users/ALICE/passkeys", &list); code != 200 || len(list.Passkeys) != 1 {
		t.Fatalf("list after delete: %d %+v", code, list)
	}
	// The audit names the admin, not the User: what tells an admin's delete
	// from the User's own.
	if ev := e.audited("passkey.removed"); ev.Sub != "ALICE" || ev.ByUser != "owner" ||
		ev.Detail["by"] != e.owner || ev.Detail["name"] != "工作电脑" {
		t.Errorf("audit: %+v", ev)
	}
	if code := e.call("DELETE", owner, "/users/ALICE/passkeys/nope", nil, nil); code != 404 {
		t.Errorf("unknown Passkey: %d", code)
	}
}

// Resetting a User's 两步验证 leaves their Passkeys alone; deleting an
// admin's Passkey takes admin-roles:assign, like the rest of acting on one.
func TestResetTwoFactorKeepsPasskeys(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil, "email:alice@example.com")
	owner := e.token(e.owner, nil)
	e.passkey("ALICE", "工作电脑", false)

	if _, err := e.pool.Exec(context.Background(),
		`INSERT INTO totp_credentials (user_id, secret, confirmed_at) VALUES ('ALICE', '\x01', now())`); err != nil {
		t.Fatal(err)
	}
	if code := e.call("DELETE", owner, "/users/ALICE/2fa", nil, nil); code != 204 {
		t.Fatalf("reset two-factor: %d", code)
	}
	var list struct {
		Passkeys []struct{ Name string } `json:"passkeys"`
	}
	if code := e.get(owner, "/users/ALICE/passkeys", &list); code != 200 || len(list.Passkeys) != 1 {
		t.Fatalf("passkeys after reset: %d %+v", code, list)
	}

	e.user("ADMIN", []string{"admin"})
	admin := e.token("ADMIN", nil)
	mine := e.passkey("ADMIN", "Passkey", false)
	if code := e.call("DELETE", admin, "/users/ADMIN/passkeys/"+mine, nil, nil); code != 403 {
		t.Errorf("admin deletes an admin's: %d, want 403", code)
	}
	if code := e.call("DELETE", owner, "/users/ADMIN/passkeys/"+mine, nil, nil); code != 204 {
		t.Errorf("owner deletes an admin's: %d", code)
	}
}
