// Application list and detail logic. Pure TypeScript: tested with node --test.
import { z } from "zod";
import type { Application } from "./console-api.ts";
import { lines } from "./onboarding.ts";

// onlyBuiltin reports whether the list holds nothing but built-in
// Applications, which counts as empty (docs/spec/consoles.md「空状态」).
export const onlyBuiltin = (apps: Pick<Application, "builtin">[]) =>
	apps.every((a) => a.builtin);

// ownCount is the overview's 应用 figure: built-in ones don't count.
export const ownCount = (apps: Pick<Application, "builtin">[]) =>
	apps.filter((a) => !a.builtin).length;

// typeName and typeWhy say what each type of Application is for.
export const typeName: Record<Application["type"], string> = {
	public: "无后端应用",
	confidential: "有后端应用",
};

export const typeWhy: Record<Application["type"], string> = {
	public:
		"适合 App、小程序和纯前端网页。没有 client secret，登录时靠 PKCE 防止授权码被截走。类型创建后不能更改。",
	confidential:
		"适合有自己服务器的网站。后端用 client secret 证明自己的身份。类型创建后不能更改。",
};

export const appName = z
	.string()
	.trim()
	.min(1, "请填写名称。")
	.max(64, "名称最多 64 个字。");

// basicSchema checks the 基本信息 section.
export const basicSchema = z.object({ name: appName });

// uriLines is a textarea of addresses, one per line; App callbacks use
// their own scheme, so any absolute URL goes.
export const uriLines = z.string().superRefine((v, ctx) => {
	const bad = lines(v).find((l) => !URL.canParse(l));
	if (bad) {
		ctx.addIssue({ code: "custom", message: `「${bad}」不是有效的地址。` });
	}
});

// createSchema checks the create page: a name and, for the web, at least
// one callback URL.
export const createSchema = (redirect: boolean) =>
	z.object({
		name: appName,
		redirectUris: redirect
			? uriLines.refine((v) => lines(v).length > 0, "请填写回调地址。")
			: z.string(),
	});

// httpURL is an optional address the server calls out to.
export const httpURL = z
	.string()
	.trim()
	.refine(
		(v) => !v || /^https?:$/.test(URL.parse(v)?.protocol ?? ""),
		"请填写 http 或 https 开头的地址。",
	);

// loginSchema checks the 登录 tab; idleDays left empty means the default.
export const loginSchema = z.object({
	redirectUris: uriLines,
	postLogoutRedirectUris: uriLines,
	idleDays: z
		.string()
		.trim()
		.refine(
			(v) => !v || (/^\d+$/.test(v) && +v >= 1 && +v <= 365),
			"请填写 1 到 365 之间的整数，或留空用默认值。",
		),
	refreshTokens: z.boolean(),
});

// webhookSchema stops a save with a webhook URL but no key, new or
// already set; the backend rejects that too.
export const webhookSchema = (secretSet: boolean) =>
	z
		.object({ webhookUrl: httpURL, webhookSecret: z.string() })
		.refine((w) => !w.webhookUrl || w.webhookSecret || secretSet, {
			path: ["webhookSecret"],
			message: "请设置 Webhook 密钥。填写通知地址后，必须同时设置密钥。",
		});
