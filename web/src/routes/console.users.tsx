import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	api,
	type Identifier,
	type Role,
	type RoleInfo,
	type User,
	type UserDetail,
} from "#/lib/console-api";
import { useCan } from "./console";

const search = z.object({
	q: z.string().optional(),
	api: z.string().optional(),
	role: z.string().optional(),
	sub: z.string().optional(), // the User shown in the side sheet
});

const managementAPI = "urn:stars-auth:management-api";

const rolesQuery = {
	queryKey: ["roles"],
	queryFn: () => api<{ roles: RoleInfo[] }>("/roles"),
};

export const Route = createFileRoute("/console/users")({
	validateSearch: search,
	component: Users,
});

const pageSize = 50;

const kindLabel: Record<Identifier["kind"], string> = {
	phone: "手机号",
	email: "邮箱",
	username: "用户名",
};

// roleKey names a Role in the filter: Role keys are unique per API only.
const roleKey = (r: Pick<Role, "api" | "key">) => `${r.api}\n${r.key}`;

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

function Users() {
	const { q = "", api: roleAPI = "", role = "", sub } = Route.useSearch();
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
		<Card>
			<CardHeader>
				<CardTitle>User</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
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
							placeholder="搜索 sub / 手机号 / 邮箱 / 用户名,回车确认"
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
						<SelectTrigger className="w-48">
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
				<div className="overflow-hidden rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Identifier</TableHead>
								<TableHead>角色</TableHead>
								<TableHead>创建于</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((u) => (
								<TableRow
									key={u.sub}
									className="cursor-pointer"
									onClick={() =>
										navigate({ search: (s) => ({ ...s, sub: u.sub }) })
									}
								>
									<TableCell className="font-mono text-xs">{u.sub}</TableCell>
									<TableCell>
										{u.identifiers.map((i) => i.value).join(" · ") || (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell>
										<Roles roles={u.roles} />
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
										className="text-center text-muted-foreground"
									>
										没有匹配的 User
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
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
			</CardContent>
			<Sheet
				open={!!sub}
				onOpenChange={(open) => {
					if (!open) navigate({ search: (s) => ({ ...s, sub: undefined }) });
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
					<SheetHeader>
						<SheetTitle>User 详情</SheetTitle>
					</SheetHeader>
					{sub && <Detail sub={sub} />}
				</SheetContent>
			</Sheet>
		</Card>
	);
}

function Roles({ roles }: { roles: Role[] }) {
	return (
		<span className="flex flex-wrap gap-1">
			{roles.map((r) => (
				<Badge key={roleKey(r)} variant="secondary">
					{r.name}
				</Badge>
			))}
		</span>
	);
}

function Detail({ sub }: { sub: string }) {
	const user = useQuery({
		queryKey: ["user", sub],
		queryFn: () => api<UserDetail>(`/users/${encodeURIComponent(sub)}`),
	});
	if (user.error) {
		return (
			<p className="px-4 text-destructive text-sm">{user.error.message}</p>
		);
	}
	const u = user.data;
	if (!u) {
		return null;
	}
	return (
		<div className="space-y-4 px-4 pb-4">
			<div>
				<div className="font-mono text-sm">{u.sub}</div>
				<div className="text-muted-foreground text-xs">
					创建于 {date(u.createdAt)}
				</div>
			</div>
			<Section title="Identifier">
				{(["phone", "email", "username"] as const).map((kind) => (
					<Row key={kind} label={kindLabel[kind]}>
						{u.identifiers.find((i) => i.kind === kind)?.value ?? (
							<span className="text-muted-foreground">未绑定</span>
						)}
					</Row>
				))}
			</Section>
			<Section title="安全">
				<Row label="密码">{u.hasPassword ? "已设置" : "未设置"}</Row>
			</Section>
			<Section title="Role">
				<RoleAssignment user={u} />
			</Section>
		</div>
	);
}

// RoleAssignment lists every API's Roles with the User's ticked; each API
// saves on its own. Management API Roles need admin-roles:assign.
function RoleAssignment({ user }: { user: UserDetail }) {
	const roles = useQuery(rolesQuery);
	const byAPI = new Map<string, RoleInfo[]>();
	for (const r of roles.data?.roles ?? []) {
		byAPI.set(r.api, [...(byAPI.get(r.api) ?? []), r]);
	}
	return (
		<div className="divide-y">
			{[...byAPI].map(([apiID, list]) => (
				<APIRoles key={apiID} user={user} apiID={apiID} roles={list} />
			))}
		</div>
	);
}

function APIRoles({
	user,
	apiID,
	roles,
}: {
	user: UserDetail;
	apiID: string;
	roles: RoleInfo[];
}) {
	const can = useCan();
	const client = useQueryClient();
	const editable = can(
		apiID === managementAPI ? "admin-roles:assign" : "roles:assign",
	);
	const held = user.roles.filter((r) => r.api === apiID).map((r) => r.key);
	const save = useMutation({
		mutationFn: (keys: string[]) =>
			api(`/users/${encodeURIComponent(user.sub)}/roles`, {
				method: "PUT",
				body: { api: apiID, roles: keys },
			}),
		onSuccess: () => client.invalidateQueries(),
	});
	return (
		<form
			key={held.join()}
			className="space-y-2 py-3"
			onSubmit={(e) => {
				e.preventDefault();
				save.mutate(new FormData(e.currentTarget).getAll("roles").map(String));
			}}
		>
			<div className="text-muted-foreground text-xs">{roles[0].apiName}</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{roles.map((r) => (
					<label key={r.key} className="flex items-center gap-1 text-sm">
						<input
							type="checkbox"
							name="roles"
							value={r.key}
							disabled={!editable}
							defaultChecked={held.includes(r.key)}
						/>
						{r.name}
					</label>
				))}
			</div>
			{save.error && (
				<p className="text-destructive text-sm">{save.error.message}</p>
			)}
			{editable && (
				<Button
					type="submit"
					size="sm"
					variant="outline"
					disabled={save.isPending}
				>
					保存
				</Button>
			)}
		</form>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-lg border px-4">
			<h3 className="pt-3 font-medium text-sm">{title}</h3>
			{children}
		</section>
	);
}

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-0">
			<span>{label}</span>
			<span>{children}</span>
		</div>
	);
}
