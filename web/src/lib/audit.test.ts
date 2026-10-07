import assert from "node:assert/strict";
import { test } from "node:test";
import {
	actor,
	describe,
	eventGroups,
	eventName,
	findUser,
	type Names,
	type Part,
} from "./audit.ts";
import type { AuditEvent } from "./console-api.ts";

// docs/spec/consoles.md「事件名与分组」
const spec: Record<string, [string, string][]> = {
	用户: [
		["user.disabled", "禁用用户"],
		["user.enabled", "恢复用户"],
		["user.deleted", "删除用户"],
		["identifier.replaced", "更换登录标识"],
		["identifier.removed", "移除登录标识"],
		["password.changed", "设置密码"],
		["password.removed", "移除密码"],
		["session.ended", "下线会话"],
		["roles.assigned", "设置角色"],
	],
	应用: [
		["create-application", "创建应用"],
		["update-application", "修改应用"],
		["delete-application", "删除应用"],
		["new-application-secret", "重新生成 client secret"],
		["webhook.failed", "用户删除通知发送失败"],
	],
	"API 资源": [
		["put-api", "保存 API 资源"],
		["delete-api", "删除 API 资源"],
		["put-permission", "保存权限"],
		["delete-permission", "删除权限"],
		["put-role", "保存角色"],
		["delete-role", "删除角色"],
	],
	登录与通道: [
		["settings.updated", "修改登录设置"],
		["put-channel", "配置验证码通道"],
		["delete-channel", "停用验证码通道"],
		["test-channel", "发送测试验证码"],
		["send.daily_cap_reached", "验证码达到每日发送上限"],
	],
	设置: [["keys.rotated", "轮换令牌签名密钥"]],
	安全: [
		["login.password_locked", "密码输错次数过多，暂时锁定"],
		["login.ip_locked", "同一 IP 登录失败过多，暂时锁定"],
		["refresh_token.reused", "疑似登录凭据被盗用，已下线会话"],
	],
};

test("every event has its name, in its group, in the spec's order", () => {
	assert.deepEqual(
		eventGroups.map(([group, events]) => [group, events]),
		Object.entries(spec),
	);
	for (const events of Object.values(spec)) {
		for (const [event, name] of events) {
			assert.equal(eventName(event), name);
		}
	}
});

test("an event not in the table still names itself", () => {
	assert.equal(eventName("set-foo"), "其他操作（set-foo）");
});

const ev = (over: Partial<AuditEvent> = {}): AuditEvent => ({
	id: 1,
	at: "2026-10-07T00:00:00Z",
	event: "user.disabled",
	detail: {},
	...over,
});

test("who did it: an admin by their primary Identifier, linked", () => {
	assert.deepEqual(
		actor(ev({ sub: "ALICE", detail: { by: "ADMIN01X" }, byUser: "admin" })),
		[{ text: "admin", user: "ADMIN01X" }],
	);
});

test("who did it: nobody is the system", () => {
	assert.deepEqual(actor(ev({ sub: "ALICE", user: "a@x.com" })), ["系统"]);
});

test("who did it: the User themselves", () => {
	assert.deepEqual(
		actor(ev({ sub: "ALICE", detail: { by: "ALICE" }, byUser: "a@x.com" })),
		["用户本人"],
	);
});

test("who did it: a deleted admin by the start of their ID", () => {
	assert.deepEqual(actor(ev({ detail: { by: "GONE1234ABCDEFGH" } })), [
		"已删除的用户 ",
		{ text: "GONE1234", mono: true },
	]);
});

const names: Names = {
	apps: [{ clientId: "SHOP", name: "星选商城" }],
	apis: [
		{
			identifier: "https://api.shop",
			name: "订单 API",
			permissions: [{ key: "orders:read", name: "读订单" }],
			roles: [
				{ key: "editor", name: "编辑" },
				{ key: "viewer", name: "只读" },
			],
		},
	],
};
const alice = { sub: "ALICE", user: "a@x.com" };
const api = "https://api.shop";
const say = (parts: Part[]) =>
	parts.map((p) => (typeof p === "string" ? p : p.text)).join("");

test("every event reads as a sentence", () => {
	const cases: [Partial<AuditEvent>, string][] = [
		[{ event: "user.disabled", ...alice }, "禁用了用户 a@x.com"],
		[{ event: "user.enabled", ...alice }, "恢复了用户 a@x.com"],
		[
			{ event: "user.deleted", sub: "ALICE123XYZ" },
			"删除了已删除的用户 ALICE123",
		],
		[
			{ event: "identifier.replaced", ...alice, detail: { kind: "phone" } },
			"更换了用户 a@x.com 的手机号",
		],
		[
			{ event: "identifier.removed", ...alice, detail: { kind: "email" } },
			"移除了用户 a@x.com 的邮箱",
		],
		[{ event: "password.changed", ...alice }, "设置了用户 a@x.com 的密码"],
		[{ event: "password.removed", ...alice }, "移除了用户 a@x.com 的密码"],
		[
			{ event: "session.ended", ...alice, detail: { session: "S1" } },
			"下线了用户 a@x.com 的一个会话",
		],
		[
			{
				event: "roles.assigned",
				...alice,
				detail: { api, roles: ["editor", "viewer"] },
			},
			"把用户 a@x.com 在 订单 API 上的角色设为 编辑、只读",
		],
		[
			{ event: "roles.assigned", ...alice, detail: { api, roles: [] } },
			"清空了用户 a@x.com 在 订单 API 上的角色",
		],
		[{ event: "create-application" }, "创建了一个应用"],
		[
			{ event: "update-application", detail: { clientId: "SHOP" } },
			"修改了应用 星选商城",
		],
		[
			{ event: "delete-application", detail: { clientId: "SHOP" } },
			"删除了应用 星选商城",
		],
		[
			{ event: "new-application-secret", detail: { clientId: "SHOP" } },
			"重新生成了应用 星选商城 的 client secret",
		],
		[
			{
				event: "webhook.failed",
				sub: "ALICE123XYZ",
				detail: { application: "SHOP", id: "D1" },
			},
			"没能把已删除的用户 ALICE123 的删除通知发给应用 星选商城",
		],
		[{ event: "put-api", detail: { api } }, "保存了 API 资源 订单 API"],
		[{ event: "delete-api", detail: { api } }, "删除了 API 资源 订单 API"],
		[
			{ event: "put-permission", detail: { api, key: "orders:read" } },
			"保存了 订单 API 的权限 读订单",
		],
		[
			{ event: "delete-permission", detail: { api, key: "orders:read" } },
			"删除了 订单 API 的权限 读订单",
		],
		[
			{ event: "put-role", detail: { api, key: "editor" } },
			"保存了 订单 API 的角色 编辑",
		],
		[
			{ event: "delete-role", detail: { api, key: "editor" } },
			"删除了 订单 API 的角色 编辑",
		],
		[{ event: "settings.updated" }, "修改了登录设置"],
		[
			{ event: "put-channel", detail: { kind: "phone" } },
			"配置了手机号验证码通道",
		],
		[
			{ event: "delete-channel", detail: { kind: "email" } },
			"停用了邮箱验证码通道",
		],
		[
			{ event: "test-channel", detail: { kind: "phone" } },
			"发送了一条手机号测试验证码",
		],
		[
			{ event: "send.daily_cap_reached", detail: { limit: 1000 } },
			"验证码达到每日上限 1000 条，今天不再发送",
		],
		[{ event: "keys.rotated" }, "轮换了令牌签名密钥"],
		[
			{ event: "login.password_locked", ...alice },
			"用户 a@x.com 密码输错次数过多，暂时锁定",
		],
		[
			{ event: "login.ip_locked", detail: { ip: "203.0.113.7" } },
			"IP 203.0.113.7 登录失败过多，暂时锁定",
		],
		[
			{ event: "refresh_token.reused", ...alice, detail: { session: "S1" } },
			"用户 a@x.com 的登录凭据疑似被盗用，已下线会话",
		],
		[
			{ event: "set-foo", detail: { x: "1", by: "ADMIN" } },
			"其他操作（set-foo）",
		],
	];
	for (const [over, want] of cases) {
		assert.equal(say(describe(ev(over), names).parts), want, over.event);
	}
});

test("Users and Applications link to their pages", () => {
	const { parts } = describe(
		ev({ event: "webhook.failed", ...alice, detail: { application: "SHOP" } }),
		names,
	);
	assert.deepEqual(
		parts.filter((p) => typeof p !== "string"),
		[
			{ text: "a@x.com", user: "ALICE" },
			{ text: "星选商城", app: "SHOP" },
		],
	);
});

test("a delivery ID goes only in the hover", () => {
	const s = describe(
		ev({
			event: "webhook.failed",
			...alice,
			detail: { application: "SHOP", id: "D1" },
		}),
		names,
	);
	assert.equal(s.title, "投递 ID：D1");
	assert.doesNotMatch(say(s.parts), /D1/);
});

test("a deleted User shows the start of their ID in monospace", () => {
	const { parts } = describe(
		ev({ event: "user.disabled", sub: "GONE1234ABC" }),
		names,
	);
	assert.deepEqual(parts, [
		"禁用了",
		"已删除的用户 ",
		{ text: "GONE1234", mono: true },
	]);
});

test("without a name, IDs show as they are, in monospace", () => {
	const mono = (over: Partial<AuditEvent>, n = names) =>
		describe(ev(over), n).parts.filter((p) => typeof p !== "string");
	// a deleted Application
	assert.deepEqual(
		mono({ event: "delete-application", detail: { clientId: "GONE" } }),
		[{ text: "GONE", mono: true }],
	);
	// no applications:read
	assert.deepEqual(
		mono(
			{ event: "update-application", detail: { clientId: "SHOP" } },
			{ ...names, apps: undefined },
		),
		[{ text: "SHOP", mono: true }],
	);
	// a deleted API resource, Role and Permission
	assert.deepEqual(
		mono({ event: "put-role", detail: { api: "https://old", key: "x" } }),
		[
			{ text: "https://old", mono: true },
			{ text: "x", mono: true },
		],
	);
	assert.deepEqual(
		mono({ event: "delete-permission", detail: { api, key: "orders:write" } }),
		[{ text: "orders:write", mono: true }],
	);
	assert.deepEqual(
		mono({
			event: "roles.assigned",
			...alice,
			detail: { api, roles: ["editor", "gone"] },
		}),
		[
			{ text: "a@x.com", user: "ALICE" },
			{ text: "gone", mono: true },
		],
	);
});

const user = (sub: string, value: string) => ({
	sub,
	identifiers: [{ kind: "email" as const, value }],
});

test("a search matching one User filters by them", () => {
	assert.deepEqual(findUser("a@x.com", [user("ALICE", "a@x.com")]), {
		sub: "ALICE",
	});
});

test("a search matching several Users lets you pick", () => {
	const users = [user("ALICE", "a@x.com"), user("ANNA", "a@y.com")];
	assert.deepEqual(findUser("a@", users), { choices: users });
});

test("a search matching nobody is taken as a deleted User's ID", () => {
	assert.deepEqual(findUser(" gone1234abc ", []), { sub: "GONE1234ABC" });
});

test("an exact Identifier picks its User among partial matches", () => {
	const users = [user("ALICE", "a@x.com"), user("AARON", "aa@x.com")];
	assert.deepEqual(findUser("A@x.com", users), { sub: "ALICE" });
});

test("without API resources to read, their IDs show as they are", () => {
	const { parts } = describe(
		ev({ event: "put-permission", detail: { api, key: "orders:read" } }),
		{ apps: undefined, apis: undefined },
	);
	assert.deepEqual(
		parts.filter((p) => typeof p !== "string"),
		[
			{ text: api, mono: true },
			{ text: "orders:read", mono: true },
		],
	);
});

test("a daily cap without its number still reads", () => {
	assert.equal(
		say(describe(ev({ event: "send.daily_cap_reached" }), names).parts),
		"验证码达到每日发送上限，今天不再发送",
	);
});
