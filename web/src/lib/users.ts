// User list and detail logic. Pure TypeScript: tested with node --test.
import type { Identifier, Role } from "./console-api.ts";

export const managementAPI = "urn:stars-auth:management-api";

// onlyAdmins reports whether the unfiltered first page of GET /users shows
// nobody but admins: no further page, and every User holds a Management
// API Role. Admins are Users (ADR 0006), so the list is never truly empty.
export const onlyAdmins = (page: {
	users: { roles: Pick<Role, "api">[] }[];
	hasMore: boolean;
}) =>
	!page.hasMore &&
	page.users.every((u) => u.roles.some((r) => r.api === managementAPI));

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
