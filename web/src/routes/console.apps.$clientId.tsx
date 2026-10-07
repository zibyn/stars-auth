import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { ConfirmDialog, DangerZone, InlineWarning } from "#/components/console";
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
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { typeName, typeWhy, webhookError } from "#/lib/apps";
import {
	type Application,
	type ApplicationSettings,
	api,
} from "#/lib/console-api";
import { useCan } from "./console";
import { apisQuery } from "./console.apis";
import { applicationsQuery } from "./console.apps.index";
import { date } from "./console.users.index";

const tabs = [
	["basic", "基本"],
	["login", "登录"],
	["webhook", "用户删除通知"],
] as const;

const search = z.object({
	tab: z.enum(["basic", "login", "webhook"]).optional().catch(undefined),
});

export const Route = createFileRoute("/console/apps/$clientId")({
	validateSearch: search,
	component: ApplicationPage,
});

const day = 86400;

const lines = (v: FormDataEntryValue | null) =>
	`${v ?? ""}`
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

// settings is what PUT takes back: every value as it was, the webhook key
// left out so the stored one stays. iOS / Android links are off the page
// until phase two but still go back unchanged.
const currentSettings = (a: Application): ApplicationSettings => ({
	name: a.name,
	redirectUris: a.redirectUris,
	postLogoutRedirectUris: a.postLogoutRedirectUris,
	defaultApi: a.defaultApi,
	sessionIdleTimeout: a.sessionIdleTimeout,
	refreshTokens: a.refreshTokens,
	webhookUrl: a.webhookUrl,
	appleAppIds: a.appleAppIds,
	androidApps: a.androidApps,
});

function ApplicationPage() {
	const { clientId } = Route.useParams();
	const { tab = "basic" } = Route.useSearch();
	const apps = useQuery(applicationsQuery);
	const can = useCan();
	if (apps.error) {
		return <p className="text-destructive text-sm">{apps.error.message}</p>;
	}
	if (!apps.data) {
		return null;
	}
	const app = apps.data.applications.find((a) => a.clientId === clientId);
	if (!app) {
		return <p className="text-sm">没有这个应用，它可能已经被删除。</p>;
	}
	const editable = can("applications:write") && !app.builtin;
	return (
		<>
			<div className="space-y-3">
				<Link
					to="/console/apps"
					className="text-muted-foreground text-sm hover:underline"
				>
					应用 ›
				</Link>
				<div className="flex items-center gap-3">
					<h1 className="font-semibold text-2xl">{app.name}</h1>
					<Badge variant="secondary">{typeName[app.type]}</Badge>
					{app.builtin && <Badge variant="outline">内置</Badge>}
				</div>
				{!editable && (
					<p className="text-muted-foreground text-sm">
						{app.builtin
							? "内置应用由认证服务自己使用，不能修改或删除。"
							: "需要「管理员」角色才能修改。"}
					</p>
				)}
				<nav className="flex gap-1 border-b">
					{tabs.map(([key, label]) => (
						<Link
							key={key}
							from={Route.fullPath}
							search={{ tab: key }}
							className={`px-3 py-2 text-sm ${tab === key ? "border-foreground border-b-2 font-medium" : "text-muted-foreground"}`}
						>
							{label}
						</Link>
					))}
				</nav>
			</div>
			{tab === "basic" && <BasicTab app={app} editable={editable} />}
			{tab === "login" && <LoginTab app={app} editable={editable} />}
			{tab === "webhook" && <WebhookTab app={app} editable={editable} />}
		</>
	);
}

// useSave writes a few settings and sends the rest back as they were,
// read from the cache so a save right after another doesn't undo it.
function useSave(app: Application) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (patch: Partial<ApplicationSettings>) => {
			const latest =
				client
					.getQueryData<{ applications: Application[] }>(
						applicationsQuery.queryKey,
					)
					?.applications.find((a) => a.clientId === app.clientId) ?? app;
			return api(`/applications/${app.clientId}`, {
				method: "PUT",
				body: { ...currentSettings(latest), ...patch },
			});
		},
		onSuccess: () => client.invalidateQueries(applicationsQuery),
	});
}

type TabProps = { app: Application; editable: boolean };

function BasicTab({ app, editable }: TabProps) {
	const save = useSave(app);
	const saveApi = useSave(app);
	const apis = useQuery(apisQuery);
	const registered = apis.data?.apis.filter((a) => !a.builtin) ?? [];
	const [defaultApi, setDefaultApi] = useState(app.defaultApi ?? "");
	return (
		<>
			<Section
				title="基本信息"
				editable={editable}
				onSubmit={(f) => save.mutate({ name: `${f.get("name")}` })}
				extra={
					<>
						<Field
							label="client_id"
							help="应用的唯一编号。在 SDK 或登录请求里填它，认证服务就知道是哪个应用。"
						>
							<div className="flex gap-2">
								<Input readOnly value={app.clientId} className="font-mono" />
								<Button
									type="button"
									variant="outline"
									onClick={() => navigator.clipboard.writeText(app.clientId)}
								>
									复制
								</Button>
							</div>
						</Field>
						{app.type === "confidential" && (
							<ClientSecret app={app} editable={editable} />
						)}
					</>
				}
				footer={editable && <SaveBar save={save} />}
			>
				<Field label="名称">
					<Input
						name="name"
						required
						defaultValue={app.name}
						placeholder="如：星选商城 App"
					/>
				</Field>
				<Field label="类型" help={typeWhy[app.type]}>
					<p className="text-sm">{typeName[app.type]}</p>
				</Field>
			</Section>
			<Section
				title="访问令牌"
				editable={editable}
				onSubmit={() => saveApi.mutate({ defaultApi })}
				footer={editable && registered.length > 0 && <SaveBar save={saveApi} />}
			>
				<Field
					label="默认 API 资源"
					help="用户登录后拿到的 access token 用于调用它，并带上用户在其中的角色。不选，token 里没有角色。"
				>
					{apis.data && registered.length === 0 ? (
						<InlineWarning
							link={{ label: "去登记 API 资源", to: "/console/apis" }}
						>
							还没有登记 API 资源。
						</InlineWarning>
					) : (
						<div className="flex items-center gap-3">
							<Select
								disabled={!editable}
								value={defaultApi}
								onValueChange={(v) => setDefaultApi(`${v ?? ""}`)}
							>
								<SelectTrigger className="flex-1">
									<SelectValue>
										{(v: string) =>
											registered.find((a) => a.identifier === v)?.name ?? "不选"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="">不选</SelectItem>
									{registered.map((a) => (
										<SelectItem key={a.identifier} value={a.identifier}>
											{a.name}
											<span className="font-mono text-muted-foreground text-xs">
												{a.identifier}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{app.defaultApi && (
								// ponytail: the API resource list until its detail page (#56)
								<Link to="/console/apis" className="text-sm underline">
									查看 API 资源
								</Link>
							)}
						</div>
					)}
				</Field>
			</Section>
			{editable && <DeleteApplication app={app} />}
		</>
	);
}

function ClientSecret({ app, editable }: TabProps) {
	const rotate = useMutation({
		mutationFn: () =>
			api<{ secret: string }>(`/applications/${app.clientId}/secret`, {
				method: "POST",
			}),
	});
	return (
		<Field
			label="client secret"
			help="你的后端换取令牌时用的密码。只在生成时显示一次，请立即保存到服务器配置里。"
		>
			{rotate.data ? (
				<p className="rounded-lg border border-amber-500 p-3 text-sm">
					新的 client secret 只显示这一次：
					<span className="block break-all font-mono">
						{rotate.data.secret}
					</span>
				</p>
			) : (
				<div className="flex gap-2">
					<Input readOnly value="••••••••••••••••" className="font-mono" />
					{editable && (
						<ConfirmDialog
							trigger={
								<Button
									type="button"
									variant="outline"
									disabled={rotate.isPending}
								>
									重新生成
								</Button>
							}
							title="重新生成 client secret？"
							action="重新生成"
							destructive={false}
							onConfirm={() => rotate.mutate()}
						>
							旧的 secret
							会立即失效，还在用它的后端会登录失败。请先准备好替换，再生成。
						</ConfirmDialog>
					)}
				</div>
			)}
			{rotate.error && (
				<p className="text-destructive text-sm">{rotate.error.message}</p>
			)}
		</Field>
	);
}

function DeleteApplication({ app }: { app: Application }) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const remove = useMutation({
		mutationFn: () =>
			api(`/applications/${app.clientId}`, { method: "DELETE" }),
		onSuccess: async () => {
			await navigate({ to: "/console/apps" });
			client.invalidateQueries(applicationsQuery);
		},
	});
	return (
		<DangerZone title="删除应用">
			<p className="text-sm">
				删除后，用户不能再通过这个应用登录。此操作无法撤销。
			</p>
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
				title={`删除「${app.name}」？`}
				action="删除应用"
				onConfirm={() => remove.mutate()}
			>
				用户将不能再通过这个应用登录。此操作无法撤销。
			</ConfirmDialog>
			{remove.error && (
				<p className="text-destructive text-sm">{remove.error.message}</p>
			)}
		</DangerZone>
	);
}

function LoginTab({ app, editable }: TabProps) {
	const save = useSave(app);
	const [refreshTokens, setRefreshTokens] = useState(app.refreshTokens);
	return (
		<Section
			title="登录跳转"
			editable={editable}
			onSubmit={(f) =>
				save.mutate({
					redirectUris: lines(f.get("redirectUris")),
					postLogoutRedirectUris: lines(f.get("postLogoutRedirectUris")),
					sessionIdleTimeout: Number(f.get("idleDays") || 0) * day,
					refreshTokens,
				})
			}
			footer={editable && <SaveBar save={save} />}
		>
			<Field
				label="回调地址"
				en="redirect URI"
				help="登录完成后跳回应用的地址。只接受这里登记过的地址。"
			>
				<Textarea
					name="redirectUris"
					className="font-mono"
					defaultValue={app.redirectUris.join("\n")}
					placeholder="每行一个，如 https://shop.example.com/callback"
				/>
			</Field>
			<details className="space-y-5">
				<summary className="cursor-pointer font-medium text-sm">高级</summary>
				<div className="mt-5 space-y-5">
					<Field
						label="退出后跳转地址"
						en="post-logout redirect URI"
						help="用户退出后回到的页面。同样只接受登记过的地址。"
					>
						<Textarea
							name="postLogoutRedirectUris"
							className="font-mono"
							defaultValue={app.postLogoutRedirectUris.join("\n")}
							placeholder="每行一个，可不填"
						/>
					</Field>
					<Field
						label="允许 App 保持登录"
						en="签发 refresh token，每次刷新都给会话续期"
						help="开启后，App 可在后台续期，用户不用反复登录。关闭后，大约 10 分钟就要重新登录。App 能保持登录多久，由这一项和下面的闲置时长共同决定。"
					>
						<Switch
							disabled={!editable}
							checked={refreshTokens}
							onCheckedChange={setRefreshTokens}
						/>
					</Field>
					<Field
						label="闲置多久需重新登录"
						help="用户连续这么多天没用这个应用，下次打开就要重新登录。改动只对之后新登录的会话生效。"
					>
						<div className="flex items-center gap-2">
							<Input
								name="idleDays"
								type="number"
								min={1}
								max={365}
								className="w-28"
								defaultValue={
									app.sessionIdleTimeout ? app.sessionIdleTimeout / day : ""
								}
								placeholder={app.type === "public" ? "默认 90" : "默认 30"}
							/>
							<span className="text-sm">天</span>
						</div>
					</Field>
				</div>
			</details>
		</Section>
	);
}

function WebhookTab({ app, editable }: TabProps) {
	const save = useSave(app);
	const [url, setUrl] = useState(app.webhookUrl ?? "");
	const [error, setError] = useState("");
	const secretSet = !!app.webhookSecretUpdatedAt;
	return (
		<Section
			title="用户删除通知"
			editable={editable}
			intro="用户被管理员删除或自己注销账号时，认证服务会通知这个地址，方便你的后端同步清理这个用户的业务数据。不需要的话留空即可。"
			onSubmit={(f, form) => {
				const secret = `${f.get("webhookSecret") ?? ""}`;
				const e = webhookError({ url, secret, secretSet });
				setError(e);
				if (!e) {
					save.mutate(
						{ webhookUrl: url, webhookSecret: secret || undefined },
						{ onSuccess: () => form.reset() },
					);
				}
			}}
			footer={editable && <SaveBar save={save} />}
		>
			<Field label="通知地址" help="需能从公网访问。">
				<Input
					type="url"
					className="font-mono"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://shop.example.com/hooks/stars"
				/>
			</Field>
			{!url && secretSet && (
				<InlineWarning>保存后 Webhook 密钥会一并清除。</InlineWarning>
			)}
			<Field
				label="Webhook 密钥"
				help="你的后端用它验证通知确实来自认证服务。填写通知地址时必须一起设置。"
			>
				{secretSet && (
					<p className="text-muted-foreground text-sm">
						已设置 · 更新于 {date(app.webhookSecretUpdatedAt ?? "")}
					</p>
				)}
				<Input
					name="webhookSecret"
					type="password"
					autoComplete="new-password"
					aria-invalid={!!error}
					placeholder="自行生成一串随机字符，可用 whsec_ 开头的格式"
				/>
			</Field>
			{error && <p className="text-destructive text-sm">{error}</p>}
		</Section>
	);
}

// Section is one form: children are what an editor may change, extra
// stays usable for readers (copying client_id).
function Section({
	title,
	intro,
	editable,
	onSubmit,
	extra,
	footer,
	children,
}: {
	title: string;
	intro?: string;
	editable: boolean;
	onSubmit: (f: FormData, form: HTMLFormElement) => void;
	extra?: ReactNode;
	footer: ReactNode;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{intro && <p className="text-muted-foreground text-sm">{intro}</p>}
			</CardHeader>
			<CardContent>
				<form
					className="space-y-5"
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit(new FormData(e.currentTarget), e.currentTarget);
					}}
				>
					<fieldset disabled={!editable} className="space-y-5">
						{children}
					</fieldset>
					{extra}
					{footer}
				</form>
			</CardContent>
		</Card>
	);
}

function SaveBar({ save }: { save: ReturnType<typeof useSave> }) {
	return (
		<div className="flex items-center gap-3">
			<Button type="submit" disabled={save.isPending}>
				保存
			</Button>
			{save.isSuccess && <span className="text-green-700 text-sm">已保存</span>}
			{save.error && (
				<span className="text-destructive text-sm">{save.error.message}</span>
			)}
		</div>
	);
}

function Field({
	label,
	en,
	help,
	children,
}: {
	label: string;
	en?: string; // the original term, in small print beside the label
	help?: string;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-1.5">
			<span className="font-medium text-sm">
				{label}
				{en && (
					<span className="ml-1 font-normal text-muted-foreground text-xs">
						{en}
					</span>
				)}
			</span>
			{children}
			{help && <p className="text-muted-foreground text-xs">{help}</p>}
		</div>
	);
}
