import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { z } from "zod";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { api, type Role, type RoleInfo, type User } from "#/lib/console-api";
import { primaryIdentifier } from "#/lib/users";

const search = z.object({
	q: z.string().optional(),
	api: z.string().optional(),
	role: z.string().optional(),
});

export const rolesQuery = {
	queryKey: ["roles"],
	queryFn: () => api<{ roles: RoleInfo[] }>("/roles"),
};

export const Route = createFileRoute("/console/users/")({
	validateSearch: search,
	component: Users,
});

const pageSize = 50;

// roleKey names a Role in the filter: Role keys are unique per API only.
const roleKey = (r: Pick<Role, "api" | "key">) => `${r.api}\n${r.key}`;

export const date = (s: string) => new Date(s).toLocaleString("zh-CN");

// userName shows a User by their primary Identifier; one with none falls
// back to the first 8 characters of their ID.
const userName = (u: User) =>
	primaryIdentifier(u.identifiers) ?? (
		<span className="font-mono text-muted-foreground">{u.sub.slice(0, 8)}</span>
	);

// Avatar is a User's initial on the primary tint; one with no Identifier
// gets the person icon.
export function Avatar({
	name,
	className = "size-6 text-xs",
}: {
	name?: string;
	className?: string;
}) {
	return (
		<span
			className={`grid shrink-0 place-items-center rounded-full bg-primary-soft font-medium text-primary-ink uppercase ${className}`}
		>
			{name ? name[0] : <UserRound className="size-3.5" />}
		</span>
	);
}

function Users() {
	const { q = "", api: roleAPI = "", role = "" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const roles = useQuery(rolesQuery);
	const users = useInfiniteQuery({
		queryKey: ["users", q, roleAPI, role],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			api<{ users: User[]; hasMore: boolean }>(
				`/users?${new URLSearchParams({ q, api: roleAPI, role, limit: `${pageSize}`, offset: `${pageParam}` })}`,
			),
		getNextPageParam: (last, pages) =>
			last.hasMore ? pages.length * pageSize : undefined,
	});
	const rows = users.data?.pages.flatMap((p) => p.users) ?? [];
	const filter = role ? roleKey({ api: roleAPI, key: role }) : "";

	return (
		<div className="space-y-6">
			<h1 className="font-semibold text-2xl tracking-tight">用户</h1>
			<div className="flex gap-2">
				<form
					className="flex-1"
					onSubmit={(e) => {
						e.preventDefault();
						const value = new FormData(e.currentTarget).get("q");
						navigate({
							search: (s) => ({ ...s, q: `${value ?? ""}` || undefined }),
						});
					}}
				>
					<Input
						key={q}
						name="q"
						type="search"
						defaultValue={q}
						placeholder="搜索手机号、邮箱、用户名或用户 ID"
					/>
				</form>
				<Select
					value={filter}
					onValueChange={(v) => {
						const [a, r] = `${v ?? ""}`.split("\n");
						navigate({
							search: (s) => ({
								...s,
								api: r ? a : undefined,
								role: r || undefined,
							}),
						});
					}}
				>
					<SelectTrigger className="w-48" aria-label="按角色筛选">
						<SelectValue>
							{(v: string) =>
								roles.data?.roles.find((r) => roleKey(r) === v)?.name ??
								"全部角色"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">全部角色</SelectItem>
						{roles.data?.roles.map((r) => (
							<SelectItem key={roleKey(r)} value={roleKey(r)}>
								{r.name}
								<span className="text-muted-foreground text-xs">
									{r.apiName}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>用户</TableHead>
						<TableHead>登录标识</TableHead>
						<TableHead>角色</TableHead>
						<TableHead>注册时间</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((u) => (
						<TableRow
							key={u.sub}
							className="cursor-pointer"
							onClick={() =>
								navigate({
									to: "/console/users/$sub",
									params: { sub: u.sub },
								})
							}
						>
							<TableCell>
								<span className="flex items-center gap-3 font-medium">
									<Avatar name={primaryIdentifier(u.identifiers)} />
									{userName(u)}
									{u.disabledAt && <Badge variant="destructive">已禁用</Badge>}
								</span>
							</TableCell>
							<TableCell className="text-muted-foreground">
								{u.identifiers.map((i) => i.value).join(" · ") || "—"}
							</TableCell>
							<TableCell>
								<span className="flex flex-wrap gap-1">
									{u.roles.map((r) => (
										<Badge key={roleKey(r)} variant="secondary">
											{r.name}
										</Badge>
									))}
								</span>
							</TableCell>
							<TableCell className="text-muted-foreground">
								{date(u.createdAt)}
							</TableCell>
						</TableRow>
					))}
					{users.isSuccess && rows.length === 0 && (
						<TableRow>
							<TableCell
								colSpan={4}
								className="space-x-2 text-center text-muted-foreground"
							>
								<span>没有符合条件的用户</span>
								<Button
									size="sm"
									variant="outline"
									onClick={() => navigate({ search: {} })}
								>
									清除筛选
								</Button>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
			{users.error && (
				<p className="text-destructive text-sm">{users.error.message}</p>
			)}
			{users.hasNextPage && (
				<Button
					variant="outline"
					disabled={users.isFetchingNextPage}
					onClick={() => users.fetchNextPage()}
				>
					加载更多
				</Button>
			)}
		</div>
	);
}
