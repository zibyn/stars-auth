// Passkeys: adding one goes through the browser's WebAuthn API and the
// Account API, with base64url coded here rather than a library
// (docs/spec/consoles.md#账号中心单页长滚动).

export type Passkey = {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt?: string;
};

// Creation options as the API sends them: the WebAuthn JSON shape, byte
// fields in base64url.
export type CreationOptions = {
	publicKey: {
		rp: { id?: string; name: string };
		user: { id: string; name: string; displayName: string };
		challenge: string;
		pubKeyCredParams: { type: "public-key"; alg: number }[];
		timeout?: number;
		excludeCredentials?: { type: "public-key"; id: string }[];
		authenticatorSelection?: Record<string, unknown>;
		attestation?: "none";
	};
};

export type RegistrationResponse = {
	id: string;
	rawId: string;
	type: string;
	response: {
		clientDataJSON: string;
		attestationObject: string;
		transports?: string[];
	};
};

// passkeySupported is whether this browser can make one at all.
export const passkeySupported = typeof PublicKeyCredential !== "undefined";

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
	const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/"));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
};

// createPasskey walks the browser through adding a Passkey: the system
// dialog, then the registration response the API takes.
export async function createPasskey(
	options: CreationOptions,
): Promise<RegistrationResponse> {
	const cred = (await navigator.credentials.create({
		publicKey: {
			...options.publicKey,
			challenge: fromB64url(options.publicKey.challenge),
			user: {
				...options.publicKey.user,
				id: fromB64url(options.publicKey.user.id),
			},
			excludeCredentials: (options.publicKey.excludeCredentials ?? []).map(
				(c) => ({ ...c, id: fromB64url(c.id) }),
			),
		},
	})) as PublicKeyCredential;
	const response = cred.response as AuthenticatorAttestationResponse;
	return {
		id: cred.id,
		rawId: b64url(cred.rawId),
		type: cred.type,
		response: {
			clientDataJSON: b64url(response.clientDataJSON),
			attestationObject: b64url(response.attestationObject),
			transports: response.getTransports?.() ?? ["internal"],
		},
	};
}
