import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
import { Switch } from "#/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Textarea } from "#/components/ui/textarea";
import {
	type APIDef,
	type Application,
	type ApplicationSettings,
	api,
	apiPath,
	type RoleDef,
} from "#/lib/console-api";
import { useCan } from "./console";

const search = z.object({
	app: z.string().optional(), // the Application in the side sheet; "new" to register one
});

export const Route = createFileRoute("/console/apps")({
	validateSearch: search,
	component: Integrations,
});

const date = (s: string) => new Date(s).toLocaleString("zh-CN");
const day = 86400;

export const apisQuery = {
	queryKey: ["apis"],
	queryFn: () => api<{ apis: APIDef[] }>("/apis"),
};

function Integrations() {
	return (
		<>
			<Applications />
			<APIs />
		</>
	);
}

function Applications() {
	const { app } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const can = useCan();
	const apps = useQuery({
		queryKey: ["applications"],
		queryFn: () => api<{ applications: Application[] }>("/applications"),
	});
	const open = (app?: string) => navigate({ search: { app } });
	const current = apps.data?.applications.find((a) => a.clientId === app);
	// A client secret shows once, across the sheet switching to the new Application.
	const [secret, setSecret] = useState<{ clientId: string; value: string }>();
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>Application</CardTitle>
				{can("applications:write") && (
					<Button onClick={() => open("new")}>注册 Application</Button>
				)}
			</CardHeader>
			<CardContent>
				<div className="overflow-hidden rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>名称</TableHead>
								<TableHead>client_id</TableHead>
								<TableHead>类型</TableHead>
								<TableHead>默认 API</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{apps.data?.applications.map((a) => (
								<TableRow
									key={a.clientId}
									className="cursor-pointer"
									onClick={() => open(a.clientId)}
								>
									<TableCell>
										{a.name}{" "}
										{a.builtin && <Badge variant="secondary">内置</Badge>}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{a.clientId}
									</TableCell>
									<TableCell>{a.type}</TableCell>
									<TableCell className="font-mono text-xs">
										{a.defaultApi || "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				{apps.error && (
					<p className="text-destructive text-sm">{apps.error.message}</p>
				)}
			</CardContent>
			<Sheet
				open={!!app}
				onOpenChange={(o) => {
					if (!o) open(undefined);
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
					<SheetHeader>
						<SheetTitle>
							{app === "new" ? "注册 Application" : "Application"}
						</SheetTitle>
					</SheetHeader>
					{(app === "new" || current) && (
						<ApplicationForm
							key={app}
							current={current}
							secret={secret && secret.clientId === app ? secret.value : ""}
							onSecret={(clientId, value) => setSecret({ clientId, value })}
							onOpen={open}
						/>
					)}
				</SheetContent>
			</Sheet>
		</Card>
	);
}

const lines = (v: FormDataEntryValue | null) =>
	`${v ?? ""}`
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

// Android apps are typed one per line: package name, then fingerprints.
const androidLines = (apps: Application["androidApps"]) =>
	apps
		.map((a) => [a.packageName, ...a.sha256CertFingerprints].join(" "))
		.join("\n");

function ApplicationForm({
	current,
	secret,
	onSecret,
	onOpen,
}: {
	current?: Application;
	secret: string;
	onSecret: (clientId: string, secret: string) => void;
	onOpen: (clientId?: string) => void;
}) {
	const can = useCan();
	const client = useQueryClient();
	const apis = useQuery(apisQuery);
	const editable = can("applications:write") && !current?.builtin;
	const [type, setType] = useState<Application["type"]>("public");
	const [defaultApi, setDefaultApi] = useState(current?.defaultApi ?? "");
	const [refreshTokens, setRefreshTokens] = useState(
		current?.refreshTokens ?? true,
	);
	const refresh = () =>
		client.invalidateQueries({ queryKey: ["applications"] });
	const path = `/applications/${current?.clientId}`;

	const save = useMutation({
		mutationFn: async (settings: ApplicationSettings) => {
			if (current) {
				await api(path, { method: "PUT", body: settings });
				return;
			}
			const out = await api<{ application: Application; secret?: string }>(
				"/applications",
				{ method: "POST", body: { type, settings } },
			);
			onSecret(out.application.clientId, out.secret ?? "");
			await refresh();
			onOpen(out.application.clientId);
		},
		onSuccess: refresh,
	});
	const rotate = useMutation({
		mutationFn: () =>
			api<{ secret: string }>(`${path}/secret`, { method: "POST" }),
		onSuccess: (out) => current && onSecret(current.clientId, out.secret),
	});
	const remove = useMutation({
		mutationFn: () => api(path, { method: "DELETE" }),
		onSuccess: () => {
			refresh();
			onOpen(undefined);
		},
	});

	return (
		<form
			className="space-y-4 px-4 pb-4"
			onSubmit={(e) => {
				e.preventDefault();
				const f = new FormData(e.currentTarget);
				save.mutate({
					name: `${f.get("name")}`,
					redirectUris: lines(f.get("redirectUris")),
					postLogoutRedirectUris: lines(f.get("postLogoutRedirectUris")),
					defaultApi,
					sessionIdleTimeout: Number(f.get("idleDays") || 0) * day,
					refreshTokens,
					webhookUrl: `${f.get("webhookUrl") ?? ""}`,
					webhookSecret: `${f.get("webhookSecret") ?? ""}`,
					appleAppIds: lines(f.get("appleAppIds")),
					androidApps: lines(f.get("androidApps")).map((l) => {
						const [packageName, ...sha256CertFingerprints] = l.split(/\s+/);
						return { packageName, sha256CertFingerprints };
					}),
				});
			}}
		>
			{current && (
				<p className="font-mono text-sm">
					client_id: {current.clientId}
					<span className="text-muted-foreground"> · {current.type}</span>
				</p>
			)}
			{secret && (
				<p className="rounded-lg border border-amber-500 p-3 text-sm">
					client secret(只显示这一次):
					<span className="break-all font-mono">{secret}</span>
				</p>
			)}
			<fieldset disabled={!editable} className="space-y-4">
				{!current && (
					<Field label="类型">
						<Select
							value={type}
							onValueChange={(v) => setType(v as Application["type"])}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="public">public(App、SPA,PKCE)</SelectItem>
								<SelectItem value="confidential">
									confidential(有后端,client secret)
								</SelectItem>
							</SelectContent>
						</Select>
					</Field>
				)}
				<Field label="名称">
					<Input name="name" required defaultValue={current?.name} />
				</Field>
				<Field label="回调地址" help="每行一个">
					<Textarea
						name="redirectUris"
						defaultValue={current?.redirectUris.join("\n")}
					/>
				</Field>
				<Field label="退出后跳转地址" help="每行一个">
					<Textarea
						name="postLogoutRedirectUris"
						defaultValue={current?.postLogoutRedirectUris.join("\n")}
					/>
				</Field>
				<Field label="默认 API" help="access token 的 aud">
					<Select
						value={defaultApi}
						onValueChange={(v) => setDefaultApi(`${v ?? ""}`)}
					>
						<SelectTrigger>
							<SelectValue>
								{(v: string) =>
									apis.data?.apis.find((a) => a.identifier === v)?.name ?? "无"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">无</SelectItem>
							{apis.data?.apis.map((a) => (
								<SelectItem key={a.identifier} value={a.identifier}>
									{a.name}
									<span className="font-mono text-muted-foreground text-xs">
										{a.identifier}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Field
					label="Session 闲置寿命(天)"
					help="留空用默认:浏览器 30 天,App 90 天"
				>
					<Input
						name="idleDays"
						type="number"
						min={1}
						max={365}
						defaultValue={
							current?.sessionIdleTimeout
								? current.sessionIdleTimeout / day
								: ""
						}
					/>
				</Field>
				<div className="flex items-center gap-2">
					<Switch
						id="refreshTokens"
						checked={refreshTokens}
						onCheckedChange={setRefreshTokens}
					/>
					<Label htmlFor="refreshTokens">签发 refresh token</Label>
				</div>
				<Field label="webhook URL" help="接收 user.deleted;留空不发送">
					<Input
						name="webhookUrl"
						type="url"
						defaultValue={current?.webhookUrl}
					/>
				</Field>
				<Field label="webhook 签名密钥">
					<Input
						name="webhookSecret"
						type="password"
						autoComplete="new-password"
						placeholder={
							current?.webhookSecretUpdatedAt
								? `已设置 · 更新于 ${date(current.webhookSecretUpdatedAt)},留空不修改`
								: ""
						}
					/>
				</Field>
				<Field label="iOS App" help="每行一个 Team ID.Bundle ID">
					<Textarea
						name="appleAppIds"
						className="font-mono"
						defaultValue={current?.appleAppIds.join("\n")}
					/>
				</Field>
				<Field
					label="Android App"
					help="每行:包名 SHA-256 签名指纹(可多个,空格分隔)"
				>
					<Textarea
						name="androidApps"
						className="font-mono"
						defaultValue={current && androidLines(current.androidApps)}
					/>
				</Field>
			</fieldset>
			{[save, rotate, remove].map(
				(m, i) =>
					m.error && (
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed list
						<p key={i} className="text-destructive text-sm">
							{m.error.message}
						</p>
					),
			)}
			{editable && (
				<div className="flex flex-wrap gap-2">
					<Button type="submit" disabled={save.isPending}>
						{current ? "保存" : "注册"}
					</Button>
					{current?.type === "confidential" && (
						<Button
							type="button"
							variant="outline"
							disabled={rotate.isPending}
							onClick={() => {
								if (
									confirm("生成新的 client secret 后,旧的立即失效。确定吗?")
								) {
									rotate.mutate();
								}
							}}
						>
							重新生成 secret
						</Button>
					)}
					{current && (
						<Button
							type="button"
							variant="outline"
							disabled={remove.isPending}
							onClick={() => {
								if (confirm(`删除 ${current.name}?它将无法再登录 User。`)) {
									remove.mutate();
								}
							}}
						>
							删除
						</Button>
					)}
				</div>
			)}
		</form>
	);
}

function Field({
	label,
	help,
	children,
}: {
	label: string;
	help?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid gap-1.5">
			<Label>{label}</Label>
			{children}
			{help && <p className="text-muted-foreground text-xs">{help}</p>}
		</div>
	);
}

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
							placeholder="标识(aud),如 https://api.example.com"
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
				{editable && !def.builtin && (
					<Button
						size="sm"
						variant="outline"
						className="ml-auto"
						onClick={() => {
							if (
								confirm(
									`删除 ${def.name}?它的 Permission、Role 和所有 Role 分配都会一起删除。`,
								)
							) {
								remove.mutate(undefined);
							}
						}}
					>
						删除
					</Button>
				)}
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
								<button
									type="button"
									aria-label={`删除 ${p.key}`}
									className="ml-1 text-muted-foreground hover:text-destructive"
									onClick={() => {
										if (confirm(`删除 ${p.key}?它也会从所有 Role 中移除。`)) {
											deletePermission.mutate(p.key);
										}
									}}
								>
									×
								</button>
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
						<Button
							size="sm"
							variant="ghost"
							disabled={remove.isPending}
							onClick={() => {
								const msg = role.users
									? `${role.name} 仍分配给 ${role.users} 个 User,删除后这些分配也会一起删除。确定吗?`
									: `删除 ${role.name}?`;
								if (confirm(msg)) remove.mutate(role.users > 0);
							}}
						>
							删除
						</Button>
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
