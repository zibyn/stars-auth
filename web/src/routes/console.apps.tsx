import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ConfirmDialog, DangerZone } from "#/components/console";
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
	type Application,
	type ApplicationSettings,
	api,
} from "#/lib/console-api";
import { useCan } from "./console";
import { apisQuery } from "./console.apis";

const search = z.object({
	app: z.string().optional(), // the Application in the side sheet; "new" to register one
});

export const Route = createFileRoute("/console/apps")({
	validateSearch: search,
	component: Applications,
});

const date = (s: string) => new Date(s).toLocaleString("zh-CN");
const day = 86400;

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
						<ConfirmDialog
							trigger={
								<Button
									type="button"
									variant="outline"
									disabled={rotate.isPending}
								>
									重新生成 secret
								</Button>
							}
							title={`重新生成 ${current.name} 的 client secret？`}
							action="重新生成"
							onConfirm={() => rotate.mutate()}
						>
							生成新的 client secret 后，旧的立即失效。
						</ConfirmDialog>
					)}
				</div>
			)}
			{editable && current && (
				<DangerZone title="删除应用">
					<p className="text-sm">删除后，它将无法再登录 User。</p>
					<ConfirmDialog
						trigger={
							<Button
								type="button"
								variant="destructive"
								disabled={remove.isPending}
							>
								删除应用
							</Button>
						}
						title={`删除应用 ${current.name}？`}
						action="删除应用"
						onConfirm={() => remove.mutate()}
					>
						删除后，它将无法再登录 User。
					</ConfirmDialog>
				</DangerZone>
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
