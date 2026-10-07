import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { APIError, api, type Me } from "#/lib/console-api";

export const Route = createFileRoute("/console")({ component: Console });

export const meQuery = queryOptions({
	queryKey: ["me"],
	queryFn: () => api<Me>("/me"),
	retry: false,
});

// useCan reports whether the signed-in admin holds a Permission; actions
// they lack are not shown.
export function useCan() {
	const { data } = useQuery(meQuery);
	return (permission: string) => !!data?.permissions.includes(permission);
}

// Top-level groups; 概览 and 审计 are not built yet.
const groups = [
	{ label: "概览", permission: "users:read" },
	{ label: "身份", permission: "users:read", to: "/console/users" },
	{ label: "接入", permission: "applications:read", to: "/console/apps" },
	{ label: "安全", permission: "config:read", to: "/console/security" },
	{ label: "审计", permission: "audit:read" },
] as const;

function Console() {
	const me = useQuery(meQuery);
	const can = useCan();
	if (me.error) {
		return (
			<main className="flex min-h-svh items-center justify-center">
				<p>
					{me.error instanceof APIError && me.error.status === 403
						? "你不是管理员,无法使用管理端"
						: `管理端加载失败:${me.error.message}`}
				</p>
			</main>
		);
	}
	if (!me.data) {
		return null;
	}
	return (
		<div className="min-h-svh bg-muted/40">
			<header className="flex h-14 items-center gap-4 border-b bg-background px-5">
				<div className="font-semibold">✦ Stars Auth</div>
				<nav className="flex gap-1">
					{groups
						.filter((g) => can(g.permission))
						.map((g) =>
							"to" in g ? (
								<Link
									key={g.label}
									to={g.to}
									className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
									activeProps={{
										className:
											"bg-primary text-primary-foreground hover:bg-primary",
									}}
								>
									{g.label}
								</Link>
							) : (
								<span
									key={g.label}
									title="即将推出"
									className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-muted-foreground/50"
								>
									{g.label}
								</span>
							),
						)}
				</nav>
				<div className="ml-auto font-mono text-muted-foreground text-xs">
					{me.data.sub}
				</div>
			</header>
			<main className="mx-auto max-w-5xl space-y-6 p-8">
				<Outlet />
			</main>
		</div>
	);
}
