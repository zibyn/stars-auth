import assert from "node:assert/strict";
import { test } from "node:test";
import { onlyBuiltin, webhookError } from "./apps.ts";

const consoleApp = { builtin: true };
const shop = { builtin: false };

test("only built-in while every Application is built in", () => {
	assert.equal(onlyBuiltin([consoleApp]), true);
});

test("not only built-in once the first own Application exists", () => {
	assert.equal(onlyBuiltin([consoleApp, shop]), false);
});

test("a webhook URL needs a key, new or already set", () => {
	const url = "https://shop.example.com/hooks";
	assert.equal(
		webhookError({ url, secret: "", secretSet: false }),
		"请设置 Webhook 密钥。填写通知地址后，必须同时设置密钥。",
	);
	assert.equal(webhookError({ url, secret: "whsec_1", secretSet: false }), "");
	assert.equal(webhookError({ url, secret: "", secretSet: true }), "");
});

test("no webhook URL needs no key", () => {
	assert.equal(webhookError({ url: "", secret: "", secretSet: false }), "");
});
