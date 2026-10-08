import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	stripSearchParams,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { ItemList } from "#/components/item-list";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "#/components/ui/item";
import { Label } from "#/components/ui/label";
import { TabsContent } from "#/components/ui/tabs";
import { defaultFor, rolesWith } from "#/lib/apis";
import {
	type APIDef,
	type Application,
	api,
	apiPath,
	type RoleDef,
} from "#/lib/console-api";
import { ConfirmDialog } from "#/routes/console/-components/confirm-dialog";
import { DangerZone } from "#/routes/console/-components/section";
import { apisQuery } from "#/routes/console/apis/index";
import { applicationsQuery } from "#/routes/console/apps/index";
import { type Header, useCan } from "#/routes/console/route";

const defaults = { tab: "permissions" } as const;
const search = z.object({
	tab: z
		.enum(["permissions", "roles"])
		.default(defaults.tab)
		.catch(defaults.tab),
});

export const Route = createFileRoute("/console/apis/$api")({
	staticData: { crumb: APIName, useHeader },
	validateSearch: search,
	search: { middlewares: [stripSearchParams(defaults)] },
	loader: async ({ context: { queryClient }, params }) => {
		const [apis] = await Promise.all([
			queryClient.ensureQueryData(apisQuery),
			queryClient.ensureQueryData(applicationsQuery),
		]);
		if (!apis.apis.some((a) => a.identifier === params.api)) {
			throw notFound();
		}
	},
	notFoundComponent: () => (
		<p className="text-sm">
			没有这个 API 资源，它可能已经被删除。
			<Link to="/console/apis" className="underline">
				返回 API 资源列表
			</Link>
		</p>
	),
	component: APIPage,
});

const tabs = [
	["permissions", "权限"],
	["roles", "角色"],
] as const;

// useAPIMutation runs a Management API write and refreshes the API list.
function useAPIMutation<T>(fn: (v: T) => Promise<unknown>) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onSuccess: () => client.invalidateQueries(apisQuery),
	});
}

// useAPI finds the API resource and the Applications defaulting to it,
// once both lists are in.
function useAPI(identifier: string) {
	const apis = useQuery(apisQuery).data;
	const apps = useQuery(applicationsQuery).data;
	const def = apis?.apis.find((a) => a.identifier === identifier);
	return {
		def,
		defaulting:
			def && apps ? defaultFor(apps.applications, def.identifier) : undefined,
	};
}

// APIName is the API resource's crumb, kept current by the query.
function APIName(): ReactNode {
	const { api: identifier } = useParams({ from: "/console/apis/$api" });
	return useAPI(identifier).def?.name;
}

function useHeader(): Header | null {
	const { api: identifier } = useParams({ from: "/console/apis/$api" });
	const { def, defaulting } = useAPI(identifier);
	if (!def || !defaulting) {
		return null;
	}
	return {
		title: def.name,
		badges: def.builtin && <Badge variant="secondary">内置</Badge>,
		tabs,
		details: (
			<dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
				<dt className="text-muted-foreground">API 资源标识符</dt>
				<dd>
					<span className="font-mono">{def.identifier}</span>
					<p className="text-[13px] text-muted-foreground">
						你的后端校验令牌时认的名字，即 access token 的 aud。
					</p>
				</dd>
				<dt className="text-muted-foreground">用作默认 API 资源</dt>
				<dd>
					{defaulting.length ? (
						<AppLinks apps={defaulting} />
					) : (
						<span className="text-muted-foreground">没有应用</span>
					)}
				</dd>
			</dl>
		),
	};
}

function APIPage() {
	const { api: identifier } = Route.useParams();
	const { apis } = useSuspenseQuery(apisQuery).data;
	const { applications } = useSuspenseQuery(applicationsQuery).data;
	const def = apis.find((a) => a.identifier === identifier);
	// The loader checked; this covers it going in a later refetch.
	if (!def) {
		throw notFound();
	}
	const defaulting = defaultFor(applications, def.identifier);
	return (
		<div className="space-y-10">
			<TabsContent value="permissions">
				<Permissions def={def} />
			</TabsContent>
			<TabsContent value="roles">
				<Roles def={def} noDefaultApps={defaulting.length === 0} />
			</TabsContent>
			<DeleteAPI def={def} defaulting={defaulting} />
		</div>
	);
}

function AppLinks({ apps }: { apps: Application[] }) {
	return (
		<span className="flex flex-wrap gap-x-3">
			{apps.map((a) => (
				<Link
					key={a.clientId}
					to="/console/apps/$clientId"
					params={{ clientId: a.clientId }}
					className="underline"
				>
					{a.name}
				</Link>
			))}
		</span>
	);
}

function Permissions({ def }: { def: APIDef }) {
	const can = useCan();
	const editable = can("applications:write") && !def.builtin;
	const base = apiPath(def.identifier);
	const put = useAPIMutation((v: { key: string; name: string }) =>
		api(`${base}/permissions/${encodeURIComponent(v.key)}`, {
			method: "PUT",
			body: { name: v.name },
		}),
	);
	const remove = useAPIMutation((key: string) =>
		api(`${base}/permissions/${encodeURIComponent(key)}`, { method: "DELETE" }),
	);
	const [adding, setAdding] = useState(false);
	const add = editable ? (
		<Button size="sm" onClick={() => setAdding(true)}>
			添加权限
		</Button>
	) : (
		<CannotCreate />
	);
	return (
		<div className="space-y-3">
			{def.permissions.length === 0 && def.builtin && (
				<p className="text-muted-foreground text-sm">
					内置 API 资源的权限由认证服务定义，不能添加。
				</p>
			)}
			{def.permissions.length === 0 && !def.builtin && !adding && (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>还没有权限</EmptyTitle>
						<EmptyDescription>
							权限是你的后端检查的最小单位，比如“导出订单”。先定义权限，再把它们组合成角色。
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>{add}</EmptyContent>
				</Empty>
			)}
			<ItemList>
				{def.permissions.map((p) => {
					const n = rolesWith(def.roles, p.key);
					return (
						<Item key={p.key}>
							<ItemContent>
								<ItemTitle>
									{p.name}
									<span className="font-mono font-normal text-muted-foreground text-xs">
										{p.key}
									</span>
								</ItemTitle>
							</ItemContent>
							{editable && (
								<ItemActions>
									<ConfirmDialog
										trigger={
											<Button
												size="sm"
												variant="ghost"
												disabled={remove.isPending}
											>
												删除
											</Button>
										}
										title={`删除权限「${p.name}」？`}
										action="删除权限"
										onConfirm={() => remove.mutate(p.key)}
									>
										{n
											? `它会从 ${n} 个角色中移除，持有这些角色的用户随即失去这项权限。此操作无法撤销。`
											: "没有角色用到它。此操作无法撤销。"}
									</ConfirmDialog>
								</ItemActions>
							)}
						</Item>
					);
				})}
			</ItemList>
			{adding ? (
				<KeyNameForm
					keyLabel="权限 key"
					keyPlaceholder="如：orders:export"
					namePlaceholder="如：导出订单"
					submit="添加权限"
					onCancel={() => setAdding(false)}
					onSubmit={(v, done) =>
						put.mutate(v, {
							onSuccess: () => {
								done();
								setAdding(false);
							},
						})
					}
				/>
			) : (
				def.permissions.length > 0 && editable && add
			)}
			{[put, remove].map(
				(m) =>
					m.error && (
						<p key={m.error.message} className="text-destructive text-sm">
							{m.error.message}
						</p>
					),
			)}
		</div>
	);
}

function KeyNameForm({
	keyLabel,
	keyPlaceholder,
	namePlaceholder,
	submit,
	onCancel,
	onSubmit,
}: {
	keyLabel: string;
	keyPlaceholder: string;
	namePlaceholder: string;
	submit: string;
	onCancel: () => void;
	onSubmit: (v: { key: string; name: string }, done: () => void) => void;
}) {
	return (
		<form
			className="flex flex-wrap gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				const form = e.currentTarget;
				const f = new FormData(form);
				onSubmit({ key: `${f.get("key")}`, name: `${f.get("name")}` }, () =>
					form.reset(),
				);
			}}
		>
			<Input
				name="key"
				required
				aria-label={keyLabel}
				placeholder={keyPlaceholder}
				className="w-56 font-mono"
			/>
			<Input
				name="name"
				required
				aria-label="名称"
				placeholder={namePlaceholder}
				className="w-40"
			/>
			<Button type="submit" size="sm">
				{submit}
			</Button>
			<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
				取消
			</Button>
		</form>
	);
}

function Roles({
	def,
	noDefaultApps,
}: {
	def: APIDef;
	noDefaultApps: boolean;
}) {
	const can = useCan();
	// Management API Roles hand out admin Permissions: owners only.
	const editable =
		can("applications:write") && (!def.builtin || can("admin-roles:assign"));
	const [adding, setAdding] = useState(false);
	const add = editable ? (
		<Button size="sm" onClick={() => setAdding(true)}>
			添加角色
		</Button>
	) : (
		<CannotCreate />
	);
	return (
		<div className="space-y-3">
			{noDefaultApps && (
				<Alert variant="warning">
					<AlertDescription>
						还没有应用以它为默认 API
						资源，给用户分配的角色不会出现在任何令牌里。{" "}
						<Link to="/console/apps">去「应用」</Link>
					</AlertDescription>
				</Alert>
			)}
			{def.roles.length === 0 && !adding && (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>还没有角色</EmptyTitle>
						<EmptyDescription>
							角色是一组权限，分给用户后，他们登录拿到的令牌里就带着这些权限。
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>{add}</EmptyContent>
				</Empty>
			)}
			<ItemList>
				{def.roles.map((r) => (
					<RoleRow key={r.key} def={def} role={r} editable={editable} />
				))}
			</ItemList>
			{adding ? (
				<RoleForm def={def} onDone={() => setAdding(false)} />
			) : (
				def.roles.length > 0 && editable && add
			)}
		</div>
	);
}

// RoleRow shows a Role and edits it in place; built-in Roles stay as they are.
function RoleRow({
	def,
	role,
	editable: canEdit,
}: {
	def: APIDef;
	role: RoleDef;
	editable: boolean;
}) {
	const editable = canEdit && !role.builtin;
	const [editing, setEditing] = useState(false);
	const remove = useAPIMutation((force: boolean) =>
		api(
			`${apiPath(def.identifier)}/roles/${encodeURIComponent(role.key)}${force ? "?force=true" : ""}`,
			{ method: "DELETE" },
		),
	);
	if (editing) {
		return (
			<Item>
				<RoleForm def={def} role={role} onDone={() => setEditing(false)} />
			</Item>
		);
	}
	return (
		<Item>
			<ItemContent>
				<ItemTitle>
					{role.name}
					<span className="font-mono font-normal text-muted-foreground text-xs">
						{role.key}
					</span>
					{role.builtin && <Badge variant="secondary">内置</Badge>}
				</ItemTitle>
				<ItemDescription className="text-xs">
					{role.permissions.length} 项权限 ·{" "}
					<Link
						to="/console/users"
						search={{ api: def.identifier, role: role.key }}
					>
						{role.users} 个用户
					</Link>
				</ItemDescription>
			</ItemContent>
			{editable && (
				<ItemActions>
					<Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
						编辑
					</Button>
					<ConfirmDialog
						trigger={
							<Button size="sm" variant="ghost" disabled={remove.isPending}>
								删除
							</Button>
						}
						title={`删除角色「${role.name}」？`}
						action="删除角色"
						onConfirm={() => remove.mutate(role.users > 0)}
					>
						{role.users
							? `它仍分配给 ${role.users} 个用户，删除后这些用户随即失去它。此操作无法撤销。`
							: "没有用户持有它。此操作无法撤销。"}
					</ConfirmDialog>
				</ItemActions>
			)}
			{remove.error && (
				<p className="basis-full text-destructive">{remove.error.message}</p>
			)}
		</Item>
	);
}

// RoleForm edits a Role; without one it defines a new one.
function RoleForm({
	def,
	role,
	onDone,
}: {
	def: APIDef;
	role?: RoleDef;
	onDone: () => void;
}) {
	const put = useAPIMutation(
		(v: { key: string; name: string; permissions: string[] }) =>
			api(`${apiPath(def.identifier)}/roles/${encodeURIComponent(v.key)}`, {
				method: "PUT",
				body: { name: v.name, permissions: v.permissions },
			}),
	);
	return (
		<form
			className="w-full space-y-3"
			onSubmit={(e) => {
				e.preventDefault();
				const f = new FormData(e.currentTarget);
				put.mutate(
					{
						key: role?.key ?? `${f.get("key")}`,
						name: `${f.get("name")}`,
						permissions: f.getAll("permissions").map(String),
					},
					{ onSuccess: onDone },
				);
			}}
		>
			<div className="flex flex-wrap gap-2">
				{!role && (
					<Input
						name="key"
						required
						aria-label="角色 key"
						placeholder="如：editor"
						className="w-40 font-mono"
					/>
				)}
				<Input
					name="name"
					required
					aria-label="名称"
					placeholder="如：编辑"
					defaultValue={role?.name}
					className="w-40"
				/>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{def.permissions.map((p) => (
					<Label key={p.key} className="font-normal">
						<Checkbox
							name="permissions"
							value={p.key}
							defaultChecked={role?.permissions.includes(p.key)}
						/>
						{p.name}
					</Label>
				))}
			</div>
			{put.error && (
				<p className="text-destructive text-sm">{put.error.message}</p>
			)}
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={put.isPending}>
					保存
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onDone}>
					取消
				</Button>
			</div>
		</form>
	);
}

function DeleteAPI({
	def,
	defaulting,
}: {
	def: APIDef;
	defaulting: Application[];
}) {
	const can = useCan();
	const client = useQueryClient();
	const navigate = useNavigate();
	// The confirm dialog already warns that role assignments go too.
	const remove = useMutation({
		mutationFn: () =>
			api(`${apiPath(def.identifier)}?force=true`, { method: "DELETE" }),
		onSuccess: async () => {
			await navigate({ to: "/console/apis" });
			client.invalidateQueries(apisQuery);
		},
	});
	if (!can("applications:write") || def.builtin) {
		return null;
	}
	return (
		<DangerZone title="删除 API 资源">
			{defaulting.length ? (
				<div className="space-y-1 text-sm">
					<p>先在这些应用里改掉默认 API 资源：</p>
					<AppLinks apps={defaulting} />
				</div>
			) : (
				<p className="text-sm">
					它的权限、角色和所有角色分配都会一起删除。此操作无法撤销。
				</p>
			)}
			<ConfirmDialog
				trigger={
					<Button
						variant="destructive"
						disabled={defaulting.length > 0 || remove.isPending}
					>
						删除 API 资源
					</Button>
				}
				title={`删除 API 资源「${def.name}」？`}
				action="删除 API 资源"
				onConfirm={() => remove.mutate()}
			>
				它的权限、角色和所有角色分配都会一起删除，用户随即失去这些角色。此操作无法撤销。
			</ConfirmDialog>
			{remove.error && (
				<p className="text-destructive text-sm">{remove.error.message}</p>
			)}
		</DangerZone>
	);
}

function CannotCreate() {
	return (
		<span className="text-muted-foreground">需要「管理员」角色才能创建。</span>
	);
}
