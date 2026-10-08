// Audit events as sentences (docs/spec/consoles.md「审计」). Pure
// TypeScript: tested with node --test.

import { z } from "zod";
import type { AuditEvent, Identifier } from "./console-api.ts";
import { kindName, query } from "./users.ts";

// Part is a piece of a sentence: plain text, or a User or Application
// that links to its page, or a raw ID in monospace when there is no name.
export type Ref = { text: string; user?: string; app?: string; mono?: boolean };
export type Part = string | Ref;

// Names are what IDs are shown as. apps is absent without
// applications:read; a missing entry means the object was deleted.
export type Names = {
	apps?: { clientId: string; name: string }[];
	apis?: {
		identifier: string;
		name: string;
		permissions: { key: string; name: string }[];
		roles: { key: string; name: string }[];
	}[];
};

// eventGroups names the events, grouped for the filter.
export const eventGroups: [string, [string, string][]][] = [
	[
		"用户",
		[
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
	],
	[
		"应用",
		[
			["create-application", "创建应用"],
			["update-application", "修改应用"],
			["delete-application", "删除应用"],
			["new-application-secret", "重新生成 client secret"],
			["webhook.failed", "用户删除通知发送失败"],
		],
	],
	[
		"API 资源",
		[
			["put-api", "保存 API 资源"],
			["delete-api", "删除 API 资源"],
			["put-permission", "保存权限"],
			["delete-permission", "删除权限"],
			["put-role", "保存角色"],
			["delete-role", "删除角色"],
		],
	],
	[
		"登录与通道",
		[
			["settings.updated", "修改登录设置"],
			["put-channel", "配置验证码通道"],
			["delete-channel", "停用验证码通道"],
			["test-channel", "发送测试验证码"],
			["send.daily_cap_reached", "验证码达到每日发送上限"],
		],
	],
	["设置", [["keys.rotated", "轮换令牌签名密钥"]]],
	[
		"安全",
		[
			["login.password_locked", "密码输错次数过多，暂时锁定"],
			["login.ip_locked", "同一 IP 登录失败过多，暂时锁定"],
			["refresh_token.reused", "疑似登录凭据被盗用，已下线会话"],
		],
	],
];

const names = new Map(eventGroups.flatMap(([, events]) => events));

// eventName names an event; one missing from the table keeps its own name
// so it can still be traced.
export const eventName = (event: string) =>
	names.get(event) ?? `其他操作（${event}）`;

const raw = (id: string): Ref => ({ text: id, mono: true });

// someone names a User by their primary Identifier, or by the start of
// their ID once they are deleted.
const someone = (sub: string, identifier?: string): Part[] =>
	identifier
		? ["用户 ", { text: identifier, user: sub }]
		: ["已删除的用户 ", raw(sub.slice(0, 8))];

// doneBy is the sub of whoever did it; undefined when the system did.
export const doneBy = (ev: AuditEvent) =>
	typeof ev.detail.by === "string" && ev.detail.by ? ev.detail.by : undefined;

// actor is who did it: an admin, the User themselves, or the system.
export function actor(ev: AuditEvent): Part[] {
	const by = doneBy(ev);
	if (!by) {
		return ["系统"];
	}
	if (by === ev.sub) {
		return ["用户本人"];
	}
	return ev.byUser ? [{ text: ev.byUser, user: by }] : someone(by);
}

// describe is the event as one sentence, with the doer left out (they
// have their own column). title holds what only belongs in a hover.
export function describe(
	ev: AuditEvent,
	names: Names,
): { parts: Part[]; title?: string } {
	const d = ev.detail;
	const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
	const user = someone(ev.sub ?? "", ev.user);
	const kind = kindName[str("kind") as Identifier["kind"]] ?? str("kind");
	const app = (clientId: string): Part => {
		const name = names.apps?.find((a) => a.clientId === clientId)?.name;
		return name ? { text: name, app: clientId } : raw(clientId);
	};
	const apiDef = names.apis?.find((a) => a.identifier === str("api"));
	const apiName: Part = apiDef?.name ?? raw(str("api"));
	const named = (list: { key: string; name: string }[] = [], key: string) =>
		list.find((x) => x.key === key)?.name ?? raw(key);
	// inAPI is a Permission or Role of the event's API resource.
	const inAPI = (verb: string, what: "permissions" | "roles"): Part[] => [
		`${verb} `,
		apiName,
		what === "roles" ? " 的角色 " : " 的权限 ",
		named(apiDef?.[what], str("key")),
	];
	switch (ev.event) {
		case "user.disabled":
			return { parts: ["禁用了", ...user] };
		case "user.enabled":
			return { parts: ["恢复了", ...user] };
		case "user.deleted":
			return {
				parts: ["删除了", ...user],
			};
		case "identifier.replaced":
			return { parts: ["更换了", ...user, ` 的${kind}`] };
		case "identifier.removed":
			return { parts: ["移除了", ...user, ` 的${kind}`] };
		case "password.changed":
			return { parts: ["设置了", ...user, " 的密码"] };
		case "password.removed":
			return { parts: ["移除了", ...user, " 的密码"] };
		case "session.ended":
			return { parts: ["下线了", ...user, " 的一个会话"] };
		case "roles.assigned": {
			const roles = Array.isArray(d.roles) ? (d.roles as string[]) : [];
			if (roles.length === 0) {
				return { parts: ["清空了", ...user, " 在 ", apiName, " 上的角色"] };
			}
			const list = roles.flatMap((r, i) => [
				...(i ? ["、"] : []),
				named(apiDef?.roles, r),
			]);
			return {
				parts: ["把", ...user, " 在 ", apiName, " 上的角色设为 ", ...list],
			};
		}
		case "create-application":
			return { parts: ["创建了一个应用"] };
		case "update-application":
			return { parts: ["修改了应用 ", app(str("clientId"))] };
		case "delete-application":
			return { parts: ["删除了应用 ", app(str("clientId"))] };
		case "new-application-secret":
			return {
				parts: ["重新生成了应用 ", app(str("clientId")), " 的 client secret"],
			};
		case "webhook.failed":
			return {
				parts: [
					"没能把",
					...user,
					" 的删除通知发给应用 ",
					app(str("application")),
				],
				title: str("id") ? `投递 ID：${str("id")}` : undefined,
			};
		case "put-api":
			return { parts: ["保存了 API 资源 ", apiName] };
		case "delete-api":
			return { parts: ["删除了 API 资源 ", apiName] };
		case "put-permission":
			return { parts: inAPI("保存了", "permissions") };
		case "delete-permission":
			return { parts: inAPI("删除了", "permissions") };
		case "put-role":
			return { parts: inAPI("保存了", "roles") };
		case "delete-role":
			return { parts: inAPI("删除了", "roles") };
		case "settings.updated":
			return { parts: ["修改了登录设置"] };
		case "put-channel":
			return { parts: [`配置了${kind}验证码通道`] };
		case "delete-channel":
			return { parts: [`停用了${kind}验证码通道`] };
		case "test-channel":
			return { parts: [`发送了一条${kind}测试验证码`] };
		case "send.daily_cap_reached":
			return {
				parts: [
					typeof d.limit === "number"
						? `验证码达到每日上限 ${d.limit} 条，今天不再发送`
						: "验证码达到每日发送上限，今天不再发送",
				],
			};
		case "keys.rotated":
			return { parts: ["轮换了令牌签名密钥"] };
		case "login.password_locked":
			return { parts: [...user, " 密码输错次数过多，暂时锁定"] };
		case "login.ip_locked":
			return { parts: [`IP ${str("ip")} 登录失败过多，暂时锁定`] };
		case "refresh_token.reused":
			return { parts: [...user, " 的登录凭据疑似被盗用，已下线会话"] };
		default:
			return { parts: [eventName(ev.event)] };
	}
}

// findUser turns the search box into the User to filter by, using the
// Users GET /users?q= found (it matches parts of values): one, or one
// whose Identifier or ID is exactly what was typed, is it; several are for
// picking; none means the box held a deleted User's ID (they can only be
// found that way).
export function findUser<
	U extends { sub: string; identifiers: { value: string }[] },
>(q: string, users: U[]): { sub: string } | { choices: U[] } {
	const typed = q.trim().toLowerCase();
	const exact = users.filter(
		(u) =>
			u.sub.toLowerCase() === typed ||
			u.identifiers.some((i) => i.value.toLowerCase() === typed),
	);
	const found = exact.length === 1 ? exact : users;
	if (found.length === 1) {
		return { sub: found[0].sub };
	}
	return found.length ? { choices: found } : { sub: q.trim().toUpperCase() };
}

// findSchema checks the user box; without users:read it can only be a
// user ID, 26 base32 characters.
export const findSchema = (canReadUsers: boolean) =>
	z.object({
		q: canReadUsers
			? query
			: query.regex(
					/^$|^[A-Z2-7]{26}$/i,
					"请填写 26 位用户 ID。没有读取用户的权限，只能按 ID 查找。",
				),
	});
