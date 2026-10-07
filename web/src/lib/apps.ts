// Application list and detail logic. Pure TypeScript: tested with node --test.
import type { Application } from "./console-api.ts";

// onlyBuiltin reports whether the list holds nothing but built-in
// Applications, which counts as empty (docs/spec/consoles.md「空状态」).
export const onlyBuiltin = (apps: Pick<Application, "builtin">[]) =>
	apps.every((a) => a.builtin);

// webhookError is what stops a save with a webhook URL but no key, new
// or already set; the backend rejects that too.
export const webhookError = (w: {
	url: string;
	secret: string;
	secretSet: boolean;
}) =>
	w.url && !w.secret && !w.secretSet
		? "请设置 Webhook 密钥。填写通知地址后，必须同时设置密钥。"
		: "";

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
