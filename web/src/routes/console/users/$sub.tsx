import {
	queryOptions,
	useIsMutating,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ItemList } from "#/components/item-list";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
} from "#/components/ui/item";
import { Label } from "#/components/ui/label";
import { UserAvatar } from "#/components/user-avatar";
import {
	APIError,
	type Application,
	api,
	type RoleInfo,
	type Session,
	type UserDetail,
} from "#/lib/console-api";
import {
	identifierKinds,
	kindName,
	managementAPI,
	primaryIdentifier,
} from "#/lib/users";
import { ConfirmDialog } from "#/routes/console/-components/confirm-dialog";
import { Section } from "#/routes/console/-components/section";
import { type Header, useCan } from "#/routes/console/route";
import { date, rolesQuery } from "#/routes/console/users/index";

export const Route = createFileRoute("/console/users/$sub")({
	staticData: { crumb: UserName, useHeader },
	loader: ({ context: { queryClient }, params: { sub } }) =>
		Promise.all([
			queryClient.ensureQueryData(userQuery(sub)),
			queryClient.ensureQueryData(sessionsQuery(sub)),
			queryClient.ensureQueryData(rolesQuery),
		]).catch((e) => {
			throw e instanceof APIError && e.status === 404 ? notFound() : e;
		}),
	notFoundComponent: () => (
		<p className="text-sm">
			没有这个用户，可能已经被删除。
			<Link to="/console/users" className="underline">
				返回用户列表
			</Link>
		</p>
	),
	component: UserPage,
});

const userQuery = (sub: string) =>
	queryOptions({
		queryKey: ["user", sub],
		queryFn: () => api<UserDetail>(`/users/${encodeURIComponent(sub)}`),
	});

const sessionsQuery = (sub: string) =>
	queryOptions({
		queryKey: ["sessions", sub],
		queryFn: () =>
			api<{ sessions: Session[] }>(
				`/users/${encodeURIComponent(sub)}/sessions`,
			),
	});

// UserName is the User's crumb: their primary Identifier, kept current by
// the query.
function UserName(): ReactNode {
	const { sub } = useParams({ from: "/console/users/$sub" });
	const u = useQuery(userQuery(sub)).data;
	return u && (primaryIdentifier(u.identifiers) ?? "未绑定登录标识");
}

// useUser is what the header and the page both read: the User, what the
// admin may do to them, and the actions they share. The header draws in
// the layout, around the page's loading and errors, so it doesn't suspend.
function useUser() {
	const { sub } = useParams({ from: "/console/users/$sub" });
	const user = useQuery(userQuery(sub));
	const can = useCan();
	const act = useUserAction(sub);
	const u = user.data;
	// Acting on an admin takes admin-roles:assign too.
	const writable =
		!!u &&
		can("users:write") &&
		(can("admin-roles:assign") ||
			!u.roles.some((r) => r.api === managementAPI));
	return { user, can, act, writable };
}

function useHeader(): Header | null {
	const { user, can, act, writable } = useUser();
	const u = user.data;
	if (user.error || !u) {
		return null;
	}
	const name = primaryIdentifier(u.identifiers);
	const who = name ? `用户 ${name}` : "这个用户";
	return {
		title: (
			<>
				<UserAvatar name={name} size="lg" />
				{name ?? "未绑定登录标识"}
			</>
		),
		badges: (
			<>
				{u.disabledAt ? (
					<Badge variant="destructive">已禁用 · {date(u.disabledAt)}</Badge>
				) : (
					<Badge variant="success">正常</Badge>
				)}
				{can("audit:read") && (
					<Link
						to="/console/audit"
						search={{ sub: u.sub, q: name ?? u.sub }}
						className="text-primary-ink text-sm hover:underline"
					>
						查看审计记录
					</Link>
				)}
			</>
		),
		actions: writable && (
			<>
				{u.disabledAt ? (
					<Button
						variant="outline"
						disabled={act.isPending}
						onClick={() => act.mutate({ method: "POST", path: "/enable" })}
					>
						恢复
					</Button>
				) : (
					<ConfirmDialog
						trigger={
							<Button variant="outline" disabled={act.isPending}>
								禁用
							</Button>
						}
						title={`禁用${who}？`}
						action="禁用用户"
						onConfirm={() => act.mutate({ method: "POST", path: "/disable" })}
					>
						禁用后该用户无法登录，所有会话立即下线；之后可以随时恢复。
					</ConfirmDialog>
				)}
				<DeleteUser
					who={who}
					disabled={act.isPending}
					onConfirm={() => act.mutate({ method: "DELETE", path: "" })}
				/>
			</>
		),
		details: act.error && (
			<p className="text-destructive text-sm">{act.error.message}</p>
		),
	};
}

function UserPage() {
	const { act, writable } = useUser();
	const { sub } = Route.useParams();
	const u = useSuspenseQuery(userQuery(sub)).data;
	return (
		<div className="space-y-10 pt-4">
			<Section title="登录标识与密码">
				<ItemList>
					{identifierKinds.map((kind) => (
						<Row key={kind} label={kindName[kind]}>
							{u.identifiers.find((i) => i.kind === kind)?.value ?? (
								<span className="text-muted-foreground">未绑定</span>
							)}
							{writable && (
								<Button
									size="sm"
									variant="ghost"
									disabled={act.isPending}
									onClick={() => {
										const value = prompt(`新的${kindName[kind]}`);
										if (value) {
											act.mutate({
												method: "PUT",
												path: `/identifiers/${kind}`,
												body: { value },
											});
										}
									}}
								>
									更换
								</Button>
							)}
						</Row>
					))}
					<Row label="密码">{u.hasPassword ? "已设置" : "未设置"}</Row>
				</ItemList>
			</Section>
			<Section title="会话">
				<Sessions sub={u.sub} writable={writable} />
			</Section>
			<Section title="角色">
				<RoleAssignment user={u} />
			</Section>
			<Collapsible>
				<CollapsibleTrigger className="flex items-center gap-1 text-[13px] text-muted-foreground [&[data-panel-open]>svg]:rotate-90">
					<ChevronRight className="size-4 transition-transform" />
					更多信息
				</CollapsibleTrigger>
				<CollapsibleContent>
					<ItemList>
						<Row label="用户 ID">
							<span className="font-mono text-xs">{u.sub}</span>
						</Row>
						<Row label="注册时间">{date(u.createdAt)}</Row>
					</ItemList>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

// DeleteUser confirms deleting a User; when an Application gets user
// deletion notifications, it says so (spec 依赖提示 #13).
function DeleteUser({
	who,
	disabled,
	onConfirm,
}: {
	who: string;
	disabled: boolean;
	onConfirm: () => void;
}) {
	const can = useCan();
	const apps = useQuery({
		queryKey: ["applications"],
		queryFn: () => api<{ applications: Application[] }>("/applications"),
		enabled: can("applications:read"),
	});
	const notifies = apps.data?.applications.some((a) => a.webhookUrl);
	return (
		<ConfirmDialog
			trigger={
				<Button variant="destructive" disabled={disabled || apps.isLoading}>
					删除
				</Button>
			}
			title={`删除${who}？`}
			action="删除用户"
			onConfirm={onConfirm}
		>
			删除等同注销：该用户的全部数据都将删除，无法恢复。
			{notifies && "会通知已配置用户删除通知的应用。"}
		</ConfirmDialog>
	);
}

// useUserAction calls a users:write operation on sub (path under
// /users/{sub}) and refreshes what it changes. The header and the page
// each hold one; both see whether a call is running and how the latest
// one since they mounted failed.
function useUserAction(sub: string) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const mutationKey = ["user-action", sub];
	const { mutate } = useMutation({
		mutationKey,
		mutationFn: (a: {
			method: "POST" | "PUT" | "DELETE";
			path: string;
			body?: unknown;
		}) =>
			api(`/users/${encodeURIComponent(sub)}${a.path}`, {
				method: a.method,
				body: a.body,
			}),
		onSuccess: (_, a) => {
			if (a.method === "DELETE") {
				navigate({ to: "/console/users" });
			}
			return client.invalidateQueries();
		},
	});
	const [since] = useState(Date.now);
	const isPending = useIsMutating({ mutationKey }) > 0;
	const error = useMutationState({
		filters: { mutationKey, predicate: (m) => m.state.submittedAt >= since },
		select: (m) => m.state.error,
	}).at(-1);
	return { mutate, isPending, error };
}

function Sessions({ sub, writable }: { sub: string; writable: boolean }) {
	const client = useQueryClient();
	const list = useSuspenseQuery(sessionsQuery(sub)).data.sessions;
	const end = useMutation({
		mutationFn: (id: string) =>
			api(
				`/users/${encodeURIComponent(sub)}/sessions/${encodeURIComponent(id)}`,
				{ method: "DELETE" },
			),
		onSuccess: () => client.invalidateQueries({ queryKey: ["sessions", sub] }),
	});
	return (
		<>
			<ItemList>
				{list.map((s) => (
					<Row
						key={s.id}
						label={`${s.kind === "app" ? "App" : "浏览器"} · ${s.application}`}
					>
						<span className="text-muted-foreground text-xs">
							{s.active
								? `活跃于 ${date(s.lastSeenAt)}`
								: `已结束 ${date(s.endedAt ?? s.expiresAt)}`}
						</span>
						{writable && s.active && (
							<Button
								size="sm"
								variant="ghost"
								disabled={end.isPending}
								onClick={() => end.mutate(s.id)}
							>
								下线
							</Button>
						)}
					</Row>
				))}
			</ItemList>
			{!list.some((s) => s.active) && (
				<div className="py-3">
					<Empty className="border">
						<EmptyHeader>
							<EmptyTitle>没有登录中的设备</EmptyTitle>
							<EmptyDescription>
								这个用户目前在任何设备上都没有保持登录。
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</div>
			)}
			{end.error && (
				<p className="py-3 text-destructive text-sm">{end.error.message}</p>
			)}
		</>
	);
}

// RoleAssignment lists every API resource's Roles with the User's ticked;
// each saves on its own. Management API Roles need admin-roles:assign.
function RoleAssignment({ user }: { user: UserDetail }) {
	const can = useCan();
	const { roles } = useSuspenseQuery(rolesQuery).data;
	const [assigning, setAssigning] = useState(false);
	const byAPI = new Map<string, RoleInfo[]>();
	for (const r of roles) {
		byAPI.set(r.api, [...(byAPI.get(r.api) ?? []), r]);
	}
	// Only the built-in Management API Roles: nothing of the reader's own.
	const noOwnRoles = roles.every((r) => r.api === managementAPI);
	const toAPIs = noOwnRoles && can("applications:read") && (
		<Link to="/console/apis" className="underline">
			去「API 资源」添加角色
		</Link>
	);
	// Without one Role the reader may assign, 分配角色 leads nowhere.
	const assignable =
		can("roles:assign") && (!noOwnRoles || can("admin-roles:assign"));
	if (user.roles.length === 0 && !assigning) {
		return (
			<div className="py-3">
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>没有角色</EmptyTitle>
						<EmptyDescription>
							这个用户目前只能登录，不带任何权限。
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						{can("roles:assign") ? (
							<>
								{assignable && (
									<Button size="sm" onClick={() => setAssigning(true)}>
										分配角色
									</Button>
								)}
								{toAPIs}
							</>
						) : (
							<span className="text-muted-foreground">
								需要「管理员」角色才能分配角色。
							</span>
						)}
					</EmptyContent>
				</Empty>
			</div>
		);
	}
	return (
		<>
			<ItemList>
				{[...byAPI].map(([apiID, list]) => (
					<APIRoles key={apiID} user={user} apiID={apiID} roles={list} />
				))}
			</ItemList>
			{can("roles:assign") && toAPIs && (
				<p className="py-3 text-sm">{toAPIs}</p>
			)}
		</>
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
		<Item
			key={held.join()}
			className="flex-col items-start gap-2"
			render={
				<form
					onSubmit={(e) => {
						e.preventDefault();
						save.mutate(
							new FormData(e.currentTarget).getAll("roles").map(String),
						);
					}}
				/>
			}
		>
			<ItemDescription className="text-[13px]">
				{roles[0].apiName}
			</ItemDescription>
			<div className="flex flex-wrap gap-x-4 gap-y-2">
				{roles.map((r) => (
					<Label key={r.key} className="font-normal">
						<Checkbox
							name="roles"
							value={r.key}
							disabled={!editable}
							defaultChecked={held.includes(r.key)}
						/>
						{r.name}
					</Label>
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
		</Item>
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
		<Item>
			<ItemContent className="text-muted-foreground">{label}</ItemContent>
			<ItemActions>{children}</ItemActions>
		</Item>
	);
}
