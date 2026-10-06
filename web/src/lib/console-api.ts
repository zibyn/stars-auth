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

// api GETs a Management API path, signing in first when needed.
export async function api<T>(path: string): Promise<T> {
	const token = accessToken();
	if (!token) {
		return login(here());
	}
	const res = await fetch(`/v1/management${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (res.status === 401) {
		sessionStorage.removeItem(tokenKey);
		return login(here());
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new APIError(res.status, body.detail ?? res.statusText);
	}
	return res.json();
}

export type Identifier = {
	kind: "phone" | "email" | "username";
	value: string;
};
export type Role = { api: string; key: string; name: string };
export type User = {
	sub: string;
	createdAt: string;
	identifiers: Identifier[];
	roles: Role[];
};
export type UserDetail = User & { hasPassword: boolean };
export type RoleInfo = Role & { apiName: string; builtin: boolean };
export type Me = { sub: string; permissions: string[] };
