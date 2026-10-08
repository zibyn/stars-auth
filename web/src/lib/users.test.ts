import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarInitial, primaryIdentifier } from "./users.ts";

test("the primary identifier is the phone, then email, then username", () => {
	const phone = { kind: "phone", value: "+8613800000001" } as const;
	const email = { kind: "email", value: "a@x.com" } as const;
	const username = { kind: "username", value: "alice" } as const;
	assert.equal(primaryIdentifier([email, username, phone]), phone.value);
	assert.equal(primaryIdentifier([username, email]), email.value);
	assert.equal(primaryIdentifier([username]), username.value);
	assert.equal(primaryIdentifier([]), undefined);
});

test("the avatar shows the identifier's first letter, past +86", () => {
	assert.equal(avatarInitial("+8613800001111"), "1");
	assert.equal(avatarInitial("+447700900123"), "+");
	assert.equal(avatarInitial("alice@example.com"), "A");
	assert.equal(avatarInitial("张三"), "张");
});
