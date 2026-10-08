import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarInitial, primaryIdentifier, searchSchema } from "./users.ts";

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

test("the user search takes up to 100 characters", () => {
	assert.equal(searchSchema.safeParse({ q: "" }).success, true);
	assert.equal(searchSchema.safeParse({ q: "a".repeat(100) }).success, true);
	assert.deepEqual(
		searchSchema.safeParse({ q: "a".repeat(101) }).error?.issues[0].message,
		"最多输入 100 个字。",
	);
});
