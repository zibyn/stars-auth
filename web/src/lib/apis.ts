// API resource list and detail logic. Pure TypeScript: tested with node --test.
import type { Application, RoleDef } from "./console-api.ts";

// defaultFor lists the Applications using an API resource as their
// default. While any do, it can't be deleted; while none do, its roles
// reach no token.
export const defaultFor = <A extends Pick<Application, "defaultApi">>(
	apps: A[],
	identifier: string,
) => apps.filter((a) => a.defaultApi === identifier);

// rolesWith counts the roles that lose a permission when it is deleted.
export const rolesWith = (
	roles: Pick<RoleDef, "permissions">[],
	permission: string,
) => roles.filter((r) => r.permissions.includes(permission)).length;
