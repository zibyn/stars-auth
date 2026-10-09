// Account center form rules, copies of the Account API's simple ones
// (internal/identity). Pure TypeScript: tested with node --test.
import { z } from "zod";

const phone = z
	.string()
	.refine(
		(v) => /^(?:\+?86)?1[3-9]\d{9}$/.test(v.replace(/[\s-]/g, "")),
		"请输入 +86 手机号",
	);

const email = z
	.string()
	.trim()
	.max(254, "请输入邮箱")
	.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "请输入邮箱");

const code = z
	.string()
	.trim()
	.regex(/^\d{6}$/, "请输入 6 位验证码");

// bindSchema checks a new phone number or email, and its code once sent.
export const bindSchema = (kind: "phone" | "email", sent: boolean) =>
	z.object({
		value: kind === "phone" ? phone : email,
		code: sent ? code : z.string(),
	});

export const passwordSchema = z.object({
	password: z.string().refine((v) => [...v].length >= 8, "密码至少 8 位"),
});

const totp = z
	.string()
	.trim()
	.regex(/^\d{6}$/, "请输入验证器中的 6 位数字");

// A recovery code, xxxx-xxxx, in any case with or without the dash.
const recoveryCode = z
	.string()
	.refine(
		(v) => /^[a-z2-7]{8}$/i.test(v.replace(/[\s-]/g, "")),
		"请输入恢复码,形如 xxxx-xxxx",
	);

// reauthMethods is, per way of reauthenticating, how its secret is checked,
// sent to POST /reauth and typed in.
const codeMethod = (kind: "phone" | "email") =>
	({
		schema: code,
		body: (secret: string) => ({ kind, code: secret }),
		label: "验证码",
		input: {
			inputMode: "numeric",
			autoComplete: "one-time-code",
			placeholder: "6 位验证码",
		},
	}) as const;
export const reauthMethods = {
	phone: codeMethod("phone"),
	email: codeMethod("email"),
	password: {
		schema: z.string().min(1, "请输入密码"),
		body: (secret: string) => ({ password: secret }),
		label: "密码",
		input: { type: "password", autoComplete: "current-password" },
	},
	totp: {
		schema: totp,
		body: (secret: string) => ({ totp: secret.trim() }),
		label: "验证器中的验证码",
		input: {
			inputMode: "numeric",
			autoComplete: "one-time-code",
			placeholder: "6 位数字",
		},
	},
	recovery: {
		schema: recoveryCode,
		body: (secret: string) => ({ recoveryCode: secret }),
		label: "恢复码",
		input: { autoComplete: "off", placeholder: "xxxx-xxxx" },
	},
} as const;

export type ReauthMethod = keyof typeof reauthMethods;

// reauthSchema checks the secret of method; a code only once it is sent.
export const reauthSchema = (method: ReauthMethod, sent: boolean) =>
	z.object({
		secret:
			(method === "phone" || method === "email") && !sent
				? z.string()
				: reauthMethods[method].schema,
	});

// totpSchema checks a code from the authenticator, confirming the TOTP.
export const totpSchema = z.object({ code: totp });

// passkeyNameSchema checks a Passkey's new name.
export const passkeyNameSchema = z.object({
	name: z
		.string()
		.trim()
		.refine(
			(v) => [...v].length >= 1 && [...v].length <= 64,
			"名称须为 1–64 个字符",
		),
});

// providerReturn is what to tell the User on coming back from a Provider
// the account center sent them to (internal/login/provider.go), or null.
export const providerReturn = (
	search: string,
	name: (id: string) => string,
): { success: string } | { error: string } | null => {
	const q = new URLSearchParams(search);
	const error = q.get("error");
	const bound = q.get("bound");
	if (error !== null) return { error };
	if (bound !== null) return { success: `已绑定 ${name(bound)}` };
	if (q.has("reauthenticated")) return { success: "已验证身份,请继续操作" };
	return null;
};

// recoveryCodesText is the file the recovery codes download as.
export const recoveryCodesText = (host: string, codes: string[]) =>
	`${host} 两步验证恢复码\n每个只能用一次。\n\n${codes.join("\n")}\n`;

export const deleteSchema = z.object({
	confirm: z.string().refine((v) => v.trim() === "注销", "请输入「注销」确认"),
});
