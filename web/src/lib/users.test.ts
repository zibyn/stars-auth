import assert from "node:assert/strict";
import { test } from "node:test";
import { managementAPI, onlyAdmins, primaryIdentifier } from "./users.ts";

const admin = { roles: [{ api: managementAPI, key: "owner", name: "所有者" }] };
const customer = { roles: [] };
const editor = {
	roles: [{ api: "https://api.example.com", key: "editor", name: "编辑" }],
};

test("only admins: one page, every user holds a Management API role", () => {
	assert.equal(onlyAdmins({ users: [admin, admin], hasMore: false }), true);
});

test("not only admins once there is another page", () => {
	assert.equal(onlyAdmins({ users: [admin], hasMore: true }), false);
});

test("not only admins once a user has no Management API role", () => {
	assert.equal(onlyAdmins({ users: [admin, customer], hasMore: false }), false);
	assert.equal(onlyAdmins({ users: [admin, editor], hasMore: false }), false);
});

test("the primary identifier is the phone, then email, then username", () => {
	const phone = { kind: "phone", value: "+8613800000001" } as const;
	const email = { kind: "email", value: "a@x.com" } as const;
	const username = { kind: "username", value: "alice" } as const;
	assert.equal(primaryIdentifier([email, username, phone]), phone.value);
	assert.equal(primaryIdentifier([username, email]), email.value);
	assert.equal(primaryIdentifier([username]), username.value);
	assert.equal(primaryIdentifier([]), undefined);
});
