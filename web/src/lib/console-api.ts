// The console signs in as the built-in public Application with code + PKCE
// and keeps the access token for this tab only. When it expires the console
// runs the flow again; the browser Session makes that a silent round trip.
// ponytail: full-page redirect on expiry; switch to refresh tokens once the
// Session model (#32) lands.

const clientID = "stars-auth-console";
const tokenKey = "console.token";
const flowKey = "console.flow";

const redirectURI = () => `${location.origin}/console/callback`;

function base64url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

// login sends the browser to the hosted login page; it never resolves.
export async function login(returnTo: string): Promise<never> {
	const verifier = random();
	const state = random();
	const challenge = base64url(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		),
	);
	sessionStorage.setItem(
		flowKey,
		JSON.stringify({ state, verifier, returnTo }),
	);
	location.assign(
		`/authorize?${new URLSearchParams({
			client_id: clientID,
			response_type: "code",
			scope: "openid",
			redirect_uri: redirectURI(),
			state,
			code_challenge: challenge,
			code_challenge_method: "S256",
		})}`,
	);
	return new Promise<never>(() => {});
}

// finishLogin redeems the callback's code and returns where to go next.
export async function finishLogin(params: URLSearchParams): Promise<string> {
	const flow = JSON.parse(sessionStorage.getItem(flowKey) ?? "null");
	sessionStorage.removeItem(flowKey);
	if (!flow || params.get("state") !== flow.state) {
		throw new Error("登录已过期,请重试");
	}
	const error = params.get("error");
	if (error) {
		throw new Error(params.get("error_description") || error);
	}
	const res = await fetch("/token", {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: params.get("code") ?? "",
			redirect_uri: redirectURI(),
			client_id: clientID,
			code_verifier: flow.verifier,
		}),
	});
	if (!res.ok) {
		throw new Error("登录失败,请重试");
	}
	const tok = await res.json();
	sessionStorage.setItem(
		tokenKey,
		JSON.stringify({
			accessToken: tok.access_token,
			expiresAt: Date.now() + tok.expires_in * 1000,
		}),
	);
	return typeof flow.returnTo === "string" &&
		flow.returnTo.startsWith("/console")
		? flow.returnTo
		: "/console";
}

function accessToken(): string | null {
	const tok = JSON.parse(sessionStorage.getItem(tokenKey) ?? "null");
	return tok && tok.expiresAt - 30_000 > Date.now() ? tok.accessToken : null;
}

const here = () => location.pathname + location.search;

export class APIError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

// api calls a Management API path, signing in first when needed; body goes
// as JSON.
export async function api<T>(
	path: string,
	init?: { method: "POST" | "PUT" | "DELETE"; body?: unknown },
): Promise<T> {
	const token = accessToken();
	if (!token) {
		return login(here());
	}
	const res = await fetch(`/v1/management${path}`, {
		method: init?.method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(init?.body !== undefined && { "Content-Type": "application/json" }),
		},
		body: init?.body === undefined ? undefined : JSON.stringify(init.body),
	});
	if (res.status === 401) {
		sessionStorage.removeItem(tokenKey);
		return login(here());
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new APIError(res.status, body.detail ?? res.statusText);
	}
	return res.status === 204 ? (undefined as T) : res.json();
}

export type Identifier = {
	kind: "phone" | "email" | "username";
	value: string;
};
export type Role = { api: string; key: string; name: string };
export type User = {
	sub: string;
	createdAt: string;
	disabledAt?: string;
	identifiers: Identifier[];
	roles: Role[];
};
export type UserDetail = User & { hasPassword: boolean };
export type RoleInfo = Role & { apiName: string; builtin: boolean };
export type Me = { sub: string; permissions: string[] };
export type Session = {
	id: string;
	kind: "browser" | "app";
	application: string;
	authTime: string;
	amr: string[];
	lastSeenAt: string;
	expiresAt: string;
	endedAt?: string;
	active: boolean;
};
export type AuditEvent = {
	id: number;
	at: string;
	event: string;
	sub?: string;
	detail: Record<string, unknown>;
};
export type Overview = {
	users: number;
	loginsToday: number;
	liveSessions: number;
	applications: number;
	sendsLastDay: number;
	dailySendLimit: number;
};

export type ChannelField = {
	key: string;
	label: string;
	type: "text" | "number" | "url";
	secret: boolean;
	optional: boolean;
	help?: string;
};
export type ChannelPlugin = {
	key: string;
	name: string;
	kinds: ("phone" | "email")[];
	fields: ChannelField[];
};
export type ChannelSettings = {
	kind: "phone" | "email";
	plugin: string;
	config: Record<string, string>;
	secrets: Record<string, string>; // field → when it was last set
	updatedAt: string;
};

export type Policy = {
	passwordLogin: "off" | "admins" | "all";
	requirePhone: boolean;
	dailySendLimit: number;
	termsUrl: string;
	privacyUrl: string;
	termsVersion: string;
	auditRetentionDays: number;
};
export type SigningKey = { kid: string; createdAt: string; current: boolean };

export type AndroidApp = {
	packageName: string;
	sha256CertFingerprints: string[];
};
export type ApplicationSettings = {
	name: string;
	redirectUris: string[];
	postLogoutRedirectUris: string[];
	defaultApi?: string;
	sessionIdleTimeout?: number; // seconds; 0 or absent for the default
	refreshTokens: boolean;
	webhookUrl?: string;
	webhookSecret?: string; // write-only; empty keeps the stored one
	appleAppIds: string[];
	androidApps: AndroidApp[];
};
export type Application = ApplicationSettings & {
	clientId: string;
	type: "public" | "confidential";
	builtin: boolean;
	createdAt: string;
	webhookSecretUpdatedAt?: string;
};
export type PermissionInfo = { key: string; name: string; builtin: boolean };
export type RoleDef = {
	key: string;
	name: string;
	builtin: boolean;
	permissions: string[];
	users: number;
};
export type APIDef = {
	identifier: string;
	name: string;
	builtin: boolean;
	permissions: PermissionInfo[];
	roles: RoleDef[];
};

// apiPath names an API in a Management API path; identifiers are often URLs.
export const apiPath = (identifier: string) =>
	`/apis/${encodeURIComponent(identifier)}`;
