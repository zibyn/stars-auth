import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFor, rolesWith } from "./apis.ts";

const orders = "https://api.example.com/orders";
const shop = { clientId: "shop", defaultApi: orders };
const blog = { clientId: "blog", defaultApi: "" };

test("an API resource used as a default lists those Applications", () => {
	// Deleting it is blocked and its roles reach tokens.
	assert.deepEqual(defaultFor([shop, blog], orders), [shop]);
});

test("an API resource no Application defaults to lists none", () => {
	// Deleting it is allowed and its roles reach no token.
	assert.deepEqual(defaultFor([blog], orders), []);
});

test("deleting a permission counts the roles that hold it", () => {
	const roles = [
		{ permissions: ["orders:read", "orders:export"] },
		{ permissions: ["orders:read"] },
	];
	assert.equal(rolesWith(roles, "orders:read"), 2);
	assert.equal(rolesWith(roles, "orders:export"), 1);
	assert.equal(rolesWith(roles, "orders:delete"), 0);
});
