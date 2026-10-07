import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { Star } from "#/components/star";
import { APIError, api, type Me } from "#/lib/console-api";
import { navGroups } from "#/lib/nav";

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

function Console() {
	const me = useQuery(meQuery);
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
		<div className="flex min-h-svh bg-canvas p-2 text-sm">
			<aside className="sticky top-2 flex h-[calc(100svh-1rem)] w-60 shrink-0 flex-col p-4">
				{/* Room to switch to other Stars products later; not clickable yet. */}
				<div className="flex items-center gap-3 px-2 py-2">
					<span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
						<Star className="size-4" />
					</span>
					<span className="leading-tight">
						<span className="block font-semibold">Stars</span>
						<span className="block text-muted-foreground text-xs">Auth</span>
					</span>
				</div>
				<nav className="mt-6 space-y-0.5">
					{navGroups(me.data.permissions).map((g) => (
						<Link
							key={g.label}
							to={g.to}
							activeOptions={{ exact: g.to === "/console" }}
							className="flex items-center rounded-lg px-3 py-2"
							inactiveProps={{
								className: "text-muted-foreground hover:text-foreground",
							}}
							activeProps={{
								className: "bg-card font-medium shadow-xs ring-1 ring-border",
							}}
						>
							{g.label}
						</Link>
					))}
				</nav>
				<div className="mt-auto flex items-center gap-3 px-3">
					<span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink">
						<UserRound className="size-3.5" />
					</span>
					<span
						className="truncate font-mono text-muted-foreground text-xs"
						title={me.data.sub}
					>
						{me.data.sub}
					</span>
				</div>
			</aside>
			<main className="min-w-0 flex-1 rounded-2xl bg-card px-14 py-11 shadow-xs ring-1 ring-border">
				<div className="max-w-4xl space-y-6">
					<Outlet />
				</div>
			</main>
		</div>
	);
}
