import { queryOptions, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useMatches,
} from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { type ComponentType, Fragment } from "react";
import { Panel } from "#/components/console";
import { Star } from "#/components/star";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { APIError, api, logout, type Me } from "#/lib/console-api";
import { navGroups } from "#/lib/nav";
import { avatarInitial } from "#/lib/users";

export const Route = createFileRoute("/console")({ component: Console });

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		// crumb names a route in the console breadcrumb: a label, or a
		// component when the name comes from data (an Application's name).
		crumb?: string | ComponentType;
	}
}

// Crumbs is the breadcrumb atop every console page, one item per matched
// route that names itself; the last is the page you're on.
function Crumbs() {
	const crumbs = useMatches().flatMap((m) =>
		m.staticData.crumb ? [{ ...m, crumb: m.staticData.crumb }] : [],
	);
	return (
		<Breadcrumb>
			<BreadcrumbList className="text-[13px]">
				{crumbs.map(({ id, pathname, crumb: C }, i) => {
					const label = typeof C === "string" ? C : <C />;
					return (
						<Fragment key={id}>
							{i > 0 && <BreadcrumbSeparator />}
							<BreadcrumbItem>
								{i < crumbs.length - 1 ? (
									<BreadcrumbLink render={<Link to={pathname} />}>
										{label}
									</BreadcrumbLink>
								) : (
									<BreadcrumbPage className="text-muted-foreground">
										{label}
									</BreadcrumbPage>
								)}
							</BreadcrumbItem>
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

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
				<nav className="mt-6 space-y-1">
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
				<DropdownMenu>
					<DropdownMenuTrigger className="mt-auto flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-card">
						<span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary-ink text-xs">
							{me.data.identifier ? (
								avatarInitial(me.data.identifier)
							) : (
								<UserRound className="size-3.5" />
							)}
						</span>
						<span className="truncate" title={me.data.identifier}>
							{me.data.identifier}
						</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="top">
						<DropdownMenuItem render={<Link to="/account" />}>
							账号中心
						</DropdownMenuItem>
						<DropdownMenuItem onClick={logout}>退出登录</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</aside>
			<Panel className="min-w-0 flex-1 px-14 py-11">
				<div className="max-w-4xl space-y-6">
					<Crumbs />
					<Outlet />
				</div>
			</Panel>
		</div>
	);
}
