// User list and detail logic. Pure TypeScript: tested with node --test.
import type { Identifier } from "./console-api.ts";

export const managementAPI = "urn:stars-auth:management-api";

// identifierKinds lists the kinds of Identifier, primary first.
export const identifierKinds: Identifier["kind"][] = [
	"phone",
	"email",
	"username",
];

// kindName is what each kind of Identifier is called.
export const kindName: Record<Identifier["kind"], string> = {
	phone: "手机号",
	email: "邮箱",
	username: "用户名",
};

// primaryIdentifier is the Identifier a User is shown by.
export const primaryIdentifier = (identifiers: Identifier[]) =>
	identifierKinds
		.map((kind) => identifiers.find((i) => i.kind === kind))
		.find(Boolean)?.value;

// avatarInitial is the letter an avatar shows for a primary Identifier,
// skipping a mainland phone number's +86.
export const avatarInitial = (identifier: string) =>
	identifier.replace(/^\+86/, "").charAt(0).toUpperCase();
