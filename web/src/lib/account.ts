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

// reauthSchema checks the password, or the code once it is sent.
export const reauthSchema = (
	method: "phone" | "email" | "password",
	sent: boolean,
) =>
	z.object({
		secret:
			method === "password"
				? z.string().min(1, "请输入密码")
				: sent
					? code
					: z.string(),
	});

// totpSchema checks a code from the authenticator, confirming the TOTP.
export const totpSchema = z.object({
	code: z
		.string()
		.trim()
		.regex(/^\d{6}$/, "请输入验证器中的 6 位数字"),
});

// recoveryCodesText is the file the recovery codes download as.
export const recoveryCodesText = (host: string, codes: string[]) =>
	`${host} 两步验证恢复码\n每个只能用一次。\n\n${codes.join("\n")}\n`;

export const deleteSchema = z.object({
	confirm: z.string().refine((v) => v.trim() === "注销", "请输入「注销」确认"),
});
