import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog, DangerZone } from "#/components/console";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { type APIDef, api, apiPath, type RoleDef } from "#/lib/console-api";
import { useCan } from "./console";

export const Route = createFileRoute("/console/apis")({ component: APIs });

export const apisQuery = {
	queryKey: ["apis"],
	queryFn: () => api<{ apis: APIDef[] }>("/apis"),
};

// useAPIMutation runs a Management API write and refreshes the API list.
function useAPIMutation<T>(fn: (v: T) => Promise<unknown>) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onSuccess: () => client.invalidateQueries({ queryKey: ["apis"] }),
	});
}

function APIs() {
	const can = useCan();
	const apis = useQuery(apisQuery);
	const create = useAPIMutation((v: { identifier: string; name: string }) =>
		api(apiPath(v.identifier), { method: "PUT", body: { name: v.name } }),
	);
	return (
		<Card>
			<CardHeader>
				<CardTitle>API</CardTitle>
				<p className="text-muted-foreground text-sm">
					每个 API 定义自己的 Permission 和 Role;access token 只带当前 aud 那个
					API 的 roles 和 entitlements。
				</p>
			</CardHeader>
			<CardContent className="space-y-6">
				{apis.error && (
					<p className="text-destructive text-sm">{apis.error.message}</p>
				)}
				{apis.data?.apis.map((a) => (
					<APISection key={a.identifier} def={a} />
				))}
				{can("applications:write") && (
					<form
						className="flex flex-wrap gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							const f = new FormData(e.currentTarget);
							create.mutate(
								{
									identifier: `${f.get("identifier")}`,
									name: `${f.get("name")}`,
								},
								{ onSuccess: () => (e.target as HTMLFormElement).reset() },
							);
						}}
					>
						<Input
							name="identifier"
							required
							placeholder="API 标识符(aud),如 https://api.example.com"
							className="w-72"
						/>
						<Input name="name" required placeholder="名称" className="w-40" />
						<Button type="submit" variant="outline" disabled={create.isPending}>
							添加 API
						</Button>
						{create.error && (
							<span className="text-destructive text-sm">
								{create.error.message}
							</span>
						)}
					</form>
				)}
			</CardContent>
		</Card>
	);
}

function APISection({ def }: { def: APIDef }) {
	const can = useCan();
	const editable = can("applications:write");
	const base = apiPath(def.identifier);
	// The confirm dialog already warns that Role assignments go too.
	const remove = useAPIMutation(() =>
		api(`${base}?force=true`, { method: "DELETE" }),
	);
	const putPermission = useAPIMutation((v: { key: string; name: string }) =>
		api(`${base}/permissions/${encodeURIComponent(v.key)}`, {
			method: "PUT",
			body: { name: v.name },
		}),
	);
	const deletePermission = useAPIMutation((key: string) =>
		api(`${base}/permissions/${encodeURIComponent(key)}`, { method: "DELETE" }),
	);
	const errors = [remove, putPermission, deletePermission]
		.map((m) => m.error?.message)
		.filter(Boolean);

	return (
		<section className="space-y-4 rounded-lg border p-4">
			<div className="flex items-center gap-3">
				<h3 className="font-medium">{def.name}</h3>
				<span className="font-mono text-muted-foreground text-xs">
					{def.identifier}
				</span>
				{def.builtin && <Badge variant="secondary">内置</Badge>}
			</div>
			{errors.map((m) => (
				<p key={m} className="text-destructive text-sm">
					{m}
				</p>
			))}

			<div className="space-y-2">
				<h4 className="text-muted-foreground text-sm">Permission</h4>
				<div className="flex flex-wrap gap-1">
					{def.permissions.map((p) => (
						<Badge key={p.key} variant="outline" title={p.name}>
							<span className="font-mono">{p.key}</span> {p.name}
							{editable && !def.builtin && (
								<ConfirmDialog
									trigger={
										<button
											type="button"
											aria-label={`删除 ${p.key}`}
											className="ml-1 text-muted-foreground hover:text-destructive"
										>
											×
										</button>
									}
									title={`删除权限 ${p.key}？`}
									action="删除权限"
									onConfirm={() => deletePermission.mutate(p.key)}
								>
									它也会从所有 Role 中移除。
								</ConfirmDialog>
							)}
						</Badge>
					))}
				</div>
				{editable && !def.builtin && (
					<KeyNameForm
						placeholder="key,如 track:write"
						submit="添加 Permission"
						onSubmit={(v, done) => putPermission.mutate(v, { onSuccess: done })}
					/>
				)}
			</div>

			<div className="space-y-2">
				<h4 className="text-muted-foreground text-sm">Role</h4>
				{def.roles.map((r) => (
					<RoleRow key={r.key} def={def} role={r} />
				))}
				{editable && (!def.builtin || can("admin-roles:assign")) && (
					<RoleRow def={def} />
				)}
			</div>

			{editable && !def.builtin && (
				<DangerZone title="删除 API 资源">
					<p className="text-sm">
						它的 Permission、Role 和所有 Role 分配都会一起删除。
					</p>
					<ConfirmDialog
						trigger={
							<Button variant="destructive" disabled={remove.isPending}>
								删除 API 资源
							</Button>
						}
						title={`删除 API 资源 ${def.name}？`}
						action="删除 API 资源"
						onConfirm={() => remove.mutate(undefined)}
					>
						它的 Permission、Role 和所有 Role 分配都会一起删除。
					</ConfirmDialog>
				</DangerZone>
			)}
		</section>
	);
}

function KeyNameForm({
	placeholder,
	submit,
	onSubmit,
}: {
	placeholder: string;
	submit: string;
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
			<Input name="key" required placeholder={placeholder} className="w-56" />
			<Input name="name" required placeholder="显示名" className="w-40" />
			<Button type="submit" size="sm" variant="outline">
				{submit}
			</Button>
		</form>
	);
}

// RoleRow shows a Role and edits it in place; without a role it defines a new one.
function RoleRow({ def, role }: { def: APIDef; role?: RoleDef }) {
	const can = useCan();
	// Management API Roles hand out admin Permissions: owners only.
	const editable =
		can("applications:write") &&
		!role?.builtin &&
		(!def.builtin || can("admin-roles:assign"));
	const [editing, setEditing] = useState(false);
	const base = apiPath(def.identifier);
	const put = useAPIMutation(
		(v: { key: string; name: string; permissions: string[] }) =>
			api(`${base}/roles/${encodeURIComponent(v.key)}`, {
				method: "PUT",
				body: { name: v.name, permissions: v.permissions },
			}),
	);
	const remove = useAPIMutation((force: boolean) =>
		api(
			`${base}/roles/${encodeURIComponent(role?.key ?? "")}${force ? "?force=true" : ""}`,
			{ method: "DELETE" },
		),
	);

	if (role && !editing) {
		return (
			<div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0">
				<span className="font-medium">{role.name}</span>
				<span className="font-mono text-muted-foreground text-xs">
					{role.key}
				</span>
				{role.builtin && <Badge variant="secondary">内置</Badge>}
				<span className="text-muted-foreground text-xs">
					{role.permissions.length} 个 Permission · {role.users} 个 User
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
							title={`删除角色 ${role.name}？`}
							action="删除角色"
							onConfirm={() => remove.mutate(role.users > 0)}
						>
							{role.users
								? `${role.name} 仍分配给 ${role.users} 个 User，删除后这些分配也会一起删除。`
								: "删除后不能恢复。"}
						</ConfirmDialog>
					</span>
				)}
				{remove.error && (
					<span className="text-destructive">{remove.error.message}</span>
				)}
			</div>
		);
	}
	if (!role && !editing) {
		return (
			<Button size="sm" variant="outline" onClick={() => setEditing(true)}>
				添加 Role
			</Button>
		);
	}
	return (
		<form
			className="space-y-2 rounded-lg border p-3"
			onSubmit={(e) => {
				e.preventDefault();
				const f = new FormData(e.currentTarget);
				put.mutate(
					{
						key: role?.key ?? `${f.get("key")}`,
						name: `${f.get("name")}`,
						permissions: f.getAll("permissions").map(String),
					},
					{ onSuccess: () => setEditing(false) },
				);
			}}
		>
			<div className="flex flex-wrap gap-2">
				{!role && (
					<Input
						name="key"
						required
						placeholder="key,如 editor"
						className="w-40"
					/>
				)}
				<Input
					name="name"
					required
					placeholder="显示名"
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
						<span className="font-mono text-xs">{p.key}</span>
					</label>
				))}
			</div>
			{put.error && (
				<p className="text-destructive text-sm">{put.error.message}</p>
			)}
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={put.isPending}>
					保存
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => setEditing(false)}
				>
					取消
				</Button>
			</div>
		</form>
	);
}
