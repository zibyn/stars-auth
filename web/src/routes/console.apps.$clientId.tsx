import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useBlocker,
	useNavigate,
} from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
	ConfirmDialog,
	DangerZone,
	Field,
	InlineWarning,
	SaveBar,
	Section,
} from "#/components/console";
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
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import { typeName, typeWhy, webhookError } from "#/lib/apps";
import {
	type Application,
	type ApplicationSettings,
	api,
} from "#/lib/console-api";
import {
	checklist,
	lines,
	newSecrets,
	type Platform,
	platformKeys,
	snippet,
} from "#/lib/onboarding";
import { useCan } from "./console";
import { apisQuery } from "./console.apis.index";
import { applicationsQuery } from "./console.apps.index";
import { date } from "./console.users.index";

const tabs = [
	["basic", "基本"],
	["login", "登录"],
	["webhook", "用户删除通知"],
] as const;

const search = z.object({
	tab: z.enum(["basic", "login", "webhook"]).optional().catch(undefined),
	// set once, by the create page: show the 接入清单 for this platform
	onboarding: z.enum(platformKeys).optional().catch(undefined),
});

export const Route = createFileRoute("/console/apps/$clientId")({
	validateSearch: search,
	component: ApplicationPage,
});

const day = 86400;

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
	const search = Route.useSearch();
	const { tab = "basic" } = search;
	// The 接入清单 shows once: kept for this visit, gone from the URL so a
	// reload or a copied link doesn't bring it back.
	const [onboarding] = useState(search.onboarding);
	const navigate = useNavigate({ from: Route.fullPath });
	useEffect(() => {
		if (search.onboarding) {
			navigate({
				search: (s) => ({ ...s, onboarding: undefined }),
				replace: true,
			});
		}
	}, [search.onboarding, navigate]);
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
		return (
			<p className="text-sm">
				没有这个应用，它可能已经被删除。
				<Link to="/console/apps" className="underline">
					返回应用列表
				</Link>
			</p>
		);
	}
	const editable = can("applications:write") && !app.builtin;
	return (
		<Tabs
			value={tab}
			onValueChange={(v) => navigate({ search: { tab: v } })}
			className="gap-6"
		>
			<div className="space-y-3">
				<Link
					to="/console/apps"
					className="text-muted-foreground text-sm hover:underline"
				>
					应用 ›
				</Link>
				<div className="flex items-center gap-3">
					<h1 className="font-semibold text-2xl tracking-tight">{app.name}</h1>
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
				{onboarding && <Onboarding app={app} platform={onboarding} />}
				<TabsList variant="line">
					{tabs.map(([key, label]) => (
						<TabsTrigger key={key} value={key}>
							{label}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
			<TabsContent value="basic">
				<BasicTab app={app} editable={editable} />
			</TabsContent>
			<TabsContent value="login">
				<LoginTab app={app} editable={editable} />
			</TabsContent>
			<TabsContent value="webhook">
				<WebhookTab app={app} editable={editable} />
			</TabsContent>
		</Tabs>
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
		<div className="space-y-10">
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
								<CopyButton value={app.clientId} />
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
				footer={
					editable &&
					registered.length > 0 && <SaveBar save={saveApi} outline />
				}
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
								<Link
									to="/console/apis/$api"
									params={{ api: app.defaultApi }}
									className="text-sm underline"
								>
									查看 API 资源
								</Link>
							)}
						</div>
					)}
				</Field>
			</Section>
			{editable && <DeleteApplication app={app} />}
		</div>
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
				<p className="rounded-xl bg-amber-500/10 p-4 text-sm">
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
			<details className="space-y-6">
				<summary className="cursor-pointer font-medium text-[13px]">
					高级
				</summary>
				<div className="mt-6 space-y-6">
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

function CopyButton({ value }: { value: string }) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => navigator.clipboard.writeText(value)}
		>
			复制
		</Button>
	);
}

const steps = {
	clientId: "记下 client_id",
	secret: "保存 client secret",
	api: "选择默认 API 资源（可以跳过）",
	code: "接入代码",
};

// Onboarding is the 接入清单 shown once, right after the create page sent
// us here; each step ticks itself from the Application. A new client
// secret holds the reader on this page until they say it's saved.
function Onboarding({
	app,
	platform,
}: {
	app: Application;
	platform: Platform;
}) {
	const [secret] = useState(() => newSecrets.get(app.clientId));
	useEffect(() => {
		newSecrets.delete(app.clientId);
	}, [app.clientId]);
	const [saved, setSaved] = useState(false);
	const holding = !!secret && !saved;
	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) =>
			holding && current.pathname !== next.pathname,
		enableBeforeUnload: () => holding,
		withResolver: true,
	});
	const issuer = location.origin;
	const code = snippet(platform, {
		issuer,
		clientId: app.clientId,
		redirectUri: app.redirectUris[0],
	});
	// After a reload the secret is gone: nothing left to save here.
	const items = checklist(app, saved || !secret);
	const tracked = items.filter((i) => i.done !== undefined);
	const body = {
		clientId: (
			<div className="flex items-center gap-2">
				<span className="font-mono text-sm">{app.clientId}</span>
				<CopyButton value={app.clientId} />
			</div>
		),
		secret: secret ? (
			<div className="space-y-2 rounded-xl bg-amber-500/10 p-4">
				<div className="flex items-center gap-2">
					<span className="break-all font-mono text-sm">{secret}</span>
					<CopyButton value={secret} />
				</div>
				<p className="text-[13px] text-muted-foreground">
					它只显示这一次，请现在保存到你服务器的配置里。丢了只能在下面重新生成，旧的会立即失效。
				</p>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						className="accent-primary"
						checked={saved}
						onChange={(e) => setSaved(e.target.checked)}
					/>
					我已保存 client secret
				</label>
			</div>
		) : (
			<p className="text-[13px] text-muted-foreground">
				client secret
				只在创建时显示一次。没保存的话，在下面「基本信息」里重新生成。
			</p>
		),
		api: (
			<p className="text-[13px] text-muted-foreground">
				选了以后，用户登录这个应用拿到的 access token 就能调用这个 API
				资源，并带上用户在其中的角色。不调用你自己的 API
				可以不选。在下面「访问令牌」里选择。
			</p>
		),
		code: (
			<div className="space-y-2">
				<p className="text-[13px] text-muted-foreground">{code.help}</p>
				<pre className="overflow-x-auto rounded-lg bg-card p-4 text-xs">
					{code.code}
				</pre>
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">认证服务地址</span>
					<span className="font-mono">{issuer}</span>
					<CopyButton value={issuer} />
				</div>
			</div>
		),
	};
	return (
		<details open className="rounded-xl bg-primary-soft p-6">
			<summary className="cursor-pointer font-semibold text-[15px]">
				接入清单{" "}
				<span className="font-normal text-faint text-xs tabular-nums">
					{tracked.filter((i) => i.done).length} / {tracked.length}
				</span>
			</summary>
			<ol className="mt-4 space-y-4">
				{items.map((item, n) => (
					<li key={item.key} className="flex gap-3">
						<span
							className={`grid size-5 shrink-0 place-items-center rounded-full text-xs ${item.done ? "bg-primary text-primary-foreground" : "bg-card text-primary-ink ring-1 ring-border"}`}
						>
							{item.done ? <Check className="size-3" /> : n + 1}
						</span>
						<div className="flex-1 space-y-1">
							<p className="font-medium text-sm">{steps[item.key]}</p>
							{body[item.key]}
						</div>
					</li>
				))}
			</ol>
			<div className="mt-4 space-y-1 text-muted-foreground text-sm">
				<p>
					用户能用哪些方式登录，去
					<Link to="/console/login" className="underline">
						「登录方式」
					</Link>
					检查。
				</p>
				<p>
					需要在用户注销时清理数据，就配置
					<Link
						from={Route.fullPath}
						search={{ tab: "webhook" }}
						className="underline"
					>
						「用户删除通知」
					</Link>
					。
				</p>
			</div>
			<ConfirmDialog
				open={blocker.status === "blocked"}
				onOpenChange={(open) => !open && blocker.reset?.()}
				title="离开前保存 client secret？"
			>
				client secret
				只显示这一次，离开后就再也看不到了。请先保存到服务器配置里，勾选「我已保存」后再离开。
			</ConfirmDialog>
		</details>
	);
}
