// The account center signs in as its built-in Application and calls the
// Account API; see oidc.ts.

import { oidcClient } from "#/lib/oidc";

export { APIError } from "#/lib/oidc";

export const { finishLogin, api, forget, logout } = oidcClient({
	clientID: "stars-auth-account",
	home: "/account",
	apiPrefix: "/v1/account",
});

export type Identifier = {
	kind: "phone" | "email" | "username";
	value: string;
};
export type Me = {
	sub: string;
	createdAt: string;
	identifiers: Identifier[];
	hasPassword: boolean;
	passwordAllowed: boolean;
	recentAuthUntil: string;
	twoFactor: {
		enabled: boolean;
		enabledAt?: string;
		recoveryCodesLeft: number;
	};
};
export type TOTPSetup = { uri: string; secret: string };
export type Session = {
	id: string;
	kind: "browser" | "app";
	application: string;
	authTime: string;
	amr: string[];
	lastSeenAt: string;
	endedAt?: string;
	active: boolean;
	current: boolean;
};
