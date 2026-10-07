import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
	ConfirmDialog,
	DangerZone,
	EmptyState,
	InlineWarning,
} from "#/components/console";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { defaultFor, rolesWith } from "#/lib/apis";
import {
	type APIDef,
	type Application,
	api,
	apiPath,
	type RoleDef,
} from "#/lib/console-api";
import { useCan } from "./console";
import { apisQuery } from "./console.apis.index";
import { applicationsQuery } from "./console.apps.index";

const search = z.object({
	tab: z.enum(["permissions", "roles"]).optional().catch(undefined),
});

export const Route = createFileRoute("/console/apis/$api")({
	validateSearch: search,
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

function APIPage() {
	const { api: identifier } = Route.useParams();
	const { tab = "permissions" } = Route.useSearch();
	const apis = useQuery(apisQuery);
	const apps = useQuery(applicationsQuery);
	const error = apis.error ?? apps.error;
	if (error) {
		return <p className="text-destructive text-sm">{error.message}</p>;
	}
	if (!apis.data || !apps.data) {
		return null;
	}
	const def = apis.data.apis.find((a) => a.identifier === identifier);
	if (!def) {
		return (
			<p className="text-sm">
				没有这个 API 资源，它可能已经被删除。
				<Link to="/console/apis" className="underline">
					返回 API 资源列表
				</Link>
			</p>
		);
	}
	const defaulting = defaultFor(apps.data.applications, def.identifier);
	return (
		<>
			<div className="space-y-3">
				<Link
					to="/console/apis"
					className="text-muted-foreground text-sm hover:underline"
				>
					API 资源 ›
				</Link>
				<div className="flex items-center gap-3">
					<h1 className="font-semibold text-2xl tracking-tight">{def.name}</h1>
					{def.builtin && <Badge variant="secondary">内置</Badge>}
				</div>
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
				<nav className="flex gap-1 border-b">
					{tabs.map(([key, label]) => (
						<Link
							key={key}
							from={Route.fullPath}
							search={{ tab: key }}
							className={`px-3 py-2 text-sm ${tab === key ? "-mb-px border-primary border-b-2 font-medium" : "text-muted-foreground hover:text-foreground"}`}
						>
							{label}
						</Link>
					))}
				</nav>
			</div>
			<div className="space-y-10">
				{tab === "permissions" && <Permissions def={def} />}
				{tab === "roles" && (
					<Roles def={def} noDefaultApps={defaulting.length === 0} />
				)}
				<DeleteAPI def={def} defaulting={defaulting} />
			</div>
		</>
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
		<Button size="sm" variant="outline" onClick={() => setAdding(true)}>
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
				<EmptyState title="还没有权限" action={add}>
					权限是你的后端检查的最小单位，比如“导出订单”。先定义权限，再把它们组合成角色。
				</EmptyState>
			)}
			<div className="divide-y divide-border">
				{def.permissions.map((p) => {
					const n = rolesWith(def.roles, p.key);
					return (
						<div key={p.key} className="flex items-center gap-2 py-3 text-sm">
							<span className="font-medium">{p.name}</span>
							<span className="font-mono text-muted-foreground text-xs">
								{p.key}
							</span>
							{editable && (
								<ConfirmDialog
									trigger={
										<Button
											size="sm"
											variant="ghost"
											className="ml-auto"
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
							)}
						</div>
					);
				})}
			</div>
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
		<Button size="sm" variant="outline" onClick={() => setAdding(true)}>
			添加角色
		</Button>
	) : (
		<CannotCreate />
	);
	return (
		<div className="space-y-3">
			{noDefaultApps && (
				<InlineWarning link={{ label: "去「应用」", to: "/console/apps" }}>
					还没有应用以它为默认 API 资源，给用户分配的角色不会出现在任何令牌里。
				</InlineWarning>
			)}
			{def.roles.length === 0 && !adding && (
				<EmptyState title="还没有角色" action={add}>
					角色是一组权限，分给用户后，他们登录拿到的令牌里就带着这些权限。
				</EmptyState>
			)}
			<div className="divide-y divide-border">
				{def.roles.map((r) => (
					<RoleRow key={r.key} def={def} role={r} editable={editable} />
				))}
			</div>
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
		return <RoleForm def={def} role={role} onDone={() => setEditing(false)} />;
	}
	return (
		<div className="flex flex-wrap items-center gap-2 py-3 text-sm">
			<span className="font-medium">{role.name}</span>
			<span className="font-mono text-muted-foreground text-xs">
				{role.key}
			</span>
			{role.builtin && <Badge variant="secondary">内置</Badge>}
			<span className="text-muted-foreground text-xs">
				{role.permissions.length} 项权限 ·{" "}
				<Link
					to="/console/users"
					search={{ api: def.identifier, role: role.key }}
					className="underline"
				>
					{role.users} 个用户
				</Link>
			</span>
			{editable && (
				<span className="ml-auto flex gap-1">
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
				</span>
			)}
			{remove.error && (
				<span className="text-destructive">{remove.error.message}</span>
			)}
		</div>
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
			className="space-y-3 py-3"
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
					<label key={p.key} className="flex items-center gap-1 text-sm">
						<input
							type="checkbox"
							name="permissions"
							value={p.key}
							defaultChecked={role?.permissions.includes(p.key)}
						/>
						{p.name}
					</label>
				))}
			</div>
			{put.error && (
				<p className="text-destructive text-sm">{put.error.message}</p>
			)}
			<div className="flex gap-2">
				{/* one solid button per screen: several rows can be in edit at
				    once, so only the new-Role form's save is solid */}
				<Button
					type="submit"
					size="sm"
					variant={role ? "outline" : "default"}
					disabled={put.isPending}
				>
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
