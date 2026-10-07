import assert from "node:assert/strict";
import { test } from "node:test";
import {
	asksRequirePhone,
	asksShorterRetention,
	asksTermsVersion,
	hasChannel,
	lastRotation,
	passwordLocksOut,
	rotatedRecently,
	sendsNothing,
	smsLocked,
	termsError,
} from "./login.ts";

const sms = { kind: "phone" as const };

test("a kind with an enabled channel can send codes", () => {
	// 必须绑定手机号 can be turned on; phone code login works.
	assert.equal(hasChannel([sms], "phone"), true);
});

test("a kind without an enabled channel can't send codes", () => {
	// 必须绑定手机号 is disabled; email code login gets 去设置通道.
	assert.equal(hasChannel([sms], "email"), false);
	assert.equal(hasChannel([], "phone"), false);
});

const terms = "https://shop.example.com/terms";
const privacy = "https://shop.example.com/privacy";

test("a terms version needs both URLs", () => {
	assert.equal(
		termsError({ termsUrl: terms, privacyUrl: "", termsVersion: "2026-10" }),
		"请填写用户协议和隐私政策的地址。设了协议版本，用户登录时要打开这两份协议才能同意。",
	);
});

test("a terms URL must be https", () => {
	assert.equal(
		termsError({
			termsUrl: "http://shop.example.com/terms",
			privacyUrl: privacy,
			termsVersion: "",
		}),
		"请填写 https 开头的协议地址。认证服务只接受 https 链接。",
	);
});

test("https URLs with a version, or no version and no URLs, save", () => {
	assert.equal(
		termsError({
			termsUrl: terms,
			privacyUrl: privacy,
			termsVersion: "2026-10",
		}),
		"",
	);
	assert.equal(
		termsError({ termsUrl: "", privacyUrl: "", termsVersion: "" }),
		"",
	);
});

test("turning 必须绑定手机号 on asks first", () => {
	assert.equal(asksRequirePhone(false, true), true);
});

test("leaving 必须绑定手机号 as it was or turning it off doesn't ask", () => {
	assert.equal(asksRequirePhone(true, true), false);
	assert.equal(asksRequirePhone(true, false), false);
	assert.equal(asksRequirePhone(false, false), false);
});

test("a new terms version asks first, the first one too", () => {
	// All users agree again on their next login.
	assert.equal(asksTermsVersion("2026-01", "2026-10"), true);
	assert.equal(asksTermsVersion("", "2026-10"), true);
});

test("the same terms version, or none, doesn't ask", () => {
	assert.equal(asksTermsVersion("2026-10", "2026-10"), false);
	assert.equal(asksTermsVersion("2026-10", ""), false);
});

test("a shorter audit retention asks first", () => {
	// Older events are deleted within the hour.
	assert.equal(asksShorterRetention(180, 30), true);
});

test("the same or a longer audit retention doesn't ask", () => {
	assert.equal(asksShorterRetention(180, 180), false);
	assert.equal(asksShorterRetention(30, 180), false);
});

test("password login off or for admins only warns", () => {
	// Username-only users can't sign in; the account center can't set one.
	assert.equal(passwordLocksOut("off"), true);
	assert.equal(passwordLocksOut("admins"), true);
});

test("password login for everyone doesn't warn", () => {
	assert.equal(passwordLocksOut("all"), false);
});

test("a daily send limit of 0 warns", () => {
	assert.equal(sendsNothing(0), true);
});

test("a daily send limit above 0 doesn't warn", () => {
	assert.equal(sendsNothing(1), false);
});

const rotatedAt = "2026-10-07T08:00:00Z";

test("rotating within a day of the last rotation warns harder", () => {
	// Tokens from the key before last stop working at once.
	assert.equal(
		rotatedRecently(rotatedAt, new Date("2026-10-08T07:59:00Z")),
		true,
	);
});

test("rotating a day or more after the last rotation doesn't", () => {
	assert.equal(
		rotatedRecently(rotatedAt, new Date("2026-10-08T08:00:00Z")),
		false,
	);
});

test("SMS can't be stopped while 必须绑定手机号 is on", () => {
	assert.equal(smsLocked("phone", true), true);
});

test("SMS can be stopped with 必须绑定手机号 off, and email always", () => {
	assert.equal(smsLocked("phone", false), false);
	assert.equal(smsLocked("email", true), false);
});

const first = { createdAt: "2026-09-01T08:00:00Z", current: false };
const second = { createdAt: "2026-10-07T08:00:00Z", current: true };

test("the current key's creation is the last rotation once a key retired", () => {
	assert.equal(lastRotation([second, first]), "2026-10-07T08:00:00Z");
});

test("a lone key was never rotated", () => {
	assert.equal(lastRotation([{ ...first, current: true }]), "");
	assert.equal(lastRotation([]), "");
});
