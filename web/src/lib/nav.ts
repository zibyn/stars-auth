// The console's top-level groups and the Permission each needs, per
// docs/spec/consoles.md「导航」. Pure TypeScript: tested with node --test.
const groups = [
	{ label: "概览", permission: "users:read", to: "/console" },
	{ label: "用户", permission: "users:read", to: "/console/users" },
	{ label: "应用", permission: "applications:read", to: "/console/apps" },
	{ label: "API 资源", permission: "applications:read", to: "/console/apis" },
	{ label: "审计", permission: "audit:read", to: "/console/audit" },
	{ label: "设置", permission: "config:read", to: "/console/settings" },
] as const;

// navGroups lists the groups an admin holding permissions can see.
export const navGroups = (permissions: readonly string[]) =>
	groups.filter((g) => permissions.includes(g.permission));
