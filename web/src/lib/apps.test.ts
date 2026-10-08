import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createSchema,
	loginSchema,
	onlyBuiltin,
	ownCount,
	webhookSchema,
} from "./apps.ts";

const consoleApp = { builtin: true };
const shop = { builtin: false };

test("only built-in while every Application is built in", () => {
	assert.equal(onlyBuiltin([consoleApp]), true);
});

test("not only built-in once the first own Application exists", () => {
	assert.equal(onlyBuiltin([consoleApp, shop]), false);
});

test("the overview counts only your own Applications", () => {
	assert.equal(ownCount([consoleApp, shop, shop]), 2);
	assert.equal(ownCount([consoleApp]), 0);
});

// fieldErrors is what a form shows under each field.
const fieldErrors = (r: {
	error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
	Object.fromEntries(
		(r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]),
	);

test("creating an Application needs a name and, on the web, callback URLs", () => {
	assert.deepEqual(
		fieldErrors(createSchema(true).safeParse({ name: " ", redirectUris: "" })),
		{ name: "请填写名称。", redirectUris: "请填写回调地址。" },
	);
	assert.deepEqual(
		fieldErrors(
			createSchema(true).safeParse({
				name: "星选商城",
				redirectUris: "https://shop.example.com/callback\nshop/callback",
			}),
		),
		{ redirectUris: "「shop/callback」不是有效的地址。" },
	);
	assert.equal(
		createSchema(false).safeParse({ name: "星选商城", redirectUris: "" })
			.success,
		true,
	);
});

test("a webhook URL needs a key, new or already set", () => {
	const webhookUrl = "https://shop.example.com/hooks";
	assert.deepEqual(
		fieldErrors(
			webhookSchema(false).safeParse({ webhookUrl, webhookSecret: "" }),
		),
		{
			webhookSecret: "请设置 Webhook 密钥。填写通知地址后，必须同时设置密钥。",
		},
	);
	assert.equal(
		webhookSchema(false).safeParse({ webhookUrl, webhookSecret: "whsec_1" })
			.success,
		true,
	);
	assert.equal(
		webhookSchema(true).safeParse({ webhookUrl, webhookSecret: "" }).success,
		true,
	);
	assert.equal(
		webhookSchema(false).safeParse({ webhookUrl: "", webhookSecret: "" })
			.success,
		true,
	);
});

test("the webhook goes to an http(s) URL", () => {
	assert.deepEqual(
		fieldErrors(
			webhookSchema(true).safeParse({
				webhookUrl: "shop.example.com",
				webhookSecret: "",
			}),
		),
		{ webhookUrl: "请填写 http 或 https 开头的地址。" },
	);
});

test("sign-in redirects are URLs and idle days a whole number up to a year", () => {
	const ok = {
		redirectUris: "com.example.shop://callback",
		postLogoutRedirectUris: "",
		idleDays: "",
		refreshTokens: true,
	};
	assert.equal(loginSchema.safeParse(ok).success, true);
	assert.equal(loginSchema.safeParse({ ...ok, idleDays: "30" }).success, true);
	for (const idleDays of ["0", "1.5", "366", "abc"]) {
		assert.deepEqual(fieldErrors(loginSchema.safeParse({ ...ok, idleDays })), {
			idleDays: "请填写 1 到 365 之间的整数，或留空用默认值。",
		});
	}
	assert.deepEqual(
		fieldErrors(
			loginSchema.safeParse({ ...ok, postLogoutRedirectUris: "/home" }),
		),
		{ postLogoutRedirectUris: "「/home」不是有效的地址。" },
	);
});
