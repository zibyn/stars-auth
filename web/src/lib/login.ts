// Login and settings dependency hints (docs/spec/consoles.md「依赖提示」).
// Pure TypeScript: tested with node --test.
import type { ChannelSettings, Policy, SigningKey } from "./console-api.ts";

// hasChannel reports whether codes can go out to a phone or an email:
// 必须绑定手机号 needs SMS, and code login needs its kind's channel.
export const hasChannel = (
	channels: Pick<ChannelSettings, "kind">[],
	kind: ChannelSettings["kind"],
) => channels.some((c) => c.kind === kind);

const isHTTPS = (u: string) => {
	try {
		const url = new URL(u);
		return url.protocol === "https:" && url.host !== "";
	} catch {
		return false;
	}
};

// termsError stops a terms save the backend would reject: a version
// needs both URLs, and every URL must be https.
export const termsError = (
	t: Pick<Policy, "termsUrl" | "privacyUrl" | "termsVersion">,
) => {
	if (t.termsVersion && !(t.termsUrl && t.privacyUrl)) {
		return "请填写用户协议和隐私政策的地址。设了协议版本，用户登录时要打开这两份协议才能同意。";
	}
	if ([t.termsUrl, t.privacyUrl].some((u) => u && !isHTTPS(u))) {
		return "请填写 https 开头的协议地址。认证服务只接受 https 链接。";
	}
	return "";
};

// smsLocked: SMS stays on while 必须绑定手机号 needs it; stopping it would
// leave users without a phone unable to bind one and so to sign in.
export const smsLocked = (
	kind: ChannelSettings["kind"],
	requirePhone: boolean,
) => kind === "phone" && requirePhone;

// asksRequirePhone: turning 必须绑定手机号 on makes users without a phone
// bind one before their next login goes through.
export const asksRequirePhone = (before: boolean, after: boolean) =>
	!before && after;

// asksTermsVersion: any new version, the first included, makes every user
// agree again; clearing it asks nothing of them.
export const asksTermsVersion = (before: string, after: string) =>
	after !== "" && after !== before;

// asksShorterRetention: the hourly cleanup deletes what falls outside the
// new period, for good.
export const asksShorterRetention = (before: number, after: number) =>
	after < before;

// passwordLocksOut: without password login for everyone, users who only
// have a username can't sign in, and the account center can't set one.
export const passwordLocksOut = (mode: Policy["passwordLogin"]) =>
	mode !== "all";

// sendsNothing: a daily limit of 0 stops every code, login and binding alike.
export const sendsNothing = (dailySendLimit: number) => dailySendLimit === 0;

// rotatedRecently: rotating again this soon retires the key before last,
// and tokens it signed stop working at once.
// ponytail: 1 day is a placeholder; tie it to the longest token lifetime.
export const rotatedRecently = (lastRotatedAt: string, now = new Date()) =>
	now.getTime() - new Date(lastRotatedAt).getTime() < 86_400_000;

// lastRotation is when the current key took over, or "" if it is the
// first: a rotation always leaves the previous key behind.
export const lastRotation = (
	keys: Pick<SigningKey, "createdAt" | "current">[],
) => (keys.length > 1 ? (keys.find((k) => k.current)?.createdAt ?? "") : "");
