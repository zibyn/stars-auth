import assert from "node:assert/strict";
import { test } from "node:test";
import { navGroups } from "./nav.ts";

const labels = (permissions: string[]) =>
	navGroups(permissions).map((g) => g.label);

test("an owner sees all seven groups in order", () => {
	assert.deepEqual(
		labels(["users:read", "applications:read", "config:read", "audit:read"]),
		["概览", "用户", "应用", "API 资源", "登录", "审计", "设置"],
	);
});

test("each group needs the Permission consoles.md lists", () => {
	assert.deepEqual(labels(["users:read"]), ["概览", "用户"]);
	assert.deepEqual(labels(["applications:read"]), ["应用", "API 资源"]);
	assert.deepEqual(labels(["config:read"]), ["登录", "设置"]);
	assert.deepEqual(labels(["audit:read"]), ["审计"]);
	assert.deepEqual(labels([]), []);
});
