import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Switch } from "#/components/ui/switch";
import {
	api,
	type ChannelPlugin,
	type ChannelSettings,
	type Policy,
	type SigningKey,
} from "#/lib/console-api";
import { useCan } from "./console";

export const Route = createFileRoute("/console/security")({
	component: Security,
});

const kinds = [
	{ kind: "phone", label: "短信", placeholder: "+8613800001111" },
	{ kind: "email", label: "邮件", placeholder: "you@example.com" },
] as const;

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

function Security() {
	return (
		<>
			<LoginPolicy />
			<Channels />
			<SigningKeys />
		</>
	);
}

const passwordModes = { off: "关闭", admins: "仅管理员", all: "所有 User" };

function LoginPolicy() {
	const can = useCan();
	const editable = can("config:write");
	const client = useQueryClient();
	const policy = useQuery({
		queryKey: ["settings"],
		queryFn: () => api<Policy>("/settings"),
	});
	const save = useMutation({
		mutationFn: (body: Policy) => api("/settings", { method: "PUT", body }),
		onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>登录策略</CardTitle>
			</CardHeader>
			<CardContent>
				{policy.error && (
					<p className="text-destructive text-sm">{policy.error.message}</p>
				)}
				{policy.data && (
					<PolicyForm
						key={JSON.stringify(policy.data)}
						current={policy.data}
						editable={editable}
						saving={save.isPending}
						error={save.error?.message}
						onSave={(p) => save.mutate(p)}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function PolicyForm({
	current,
	editable,
	saving,
	error,
	onSave,
}: {
	current: Policy;
	editable: boolean;
	saving: boolean;
	error?: string;
	onSave: (p: Policy) => void;
}) {
	const [passwordLogin, setPasswordLogin] = useState(current.passwordLogin);
	const [requirePhone, setRequirePhone] = useState(current.requirePhone);
	return (
		<form
			className="grid gap-4 sm:grid-cols-2"
			onSubmit={(e) => {
				e.preventDefault();
				const f = new FormData(e.currentTarget);
				const text = (k: string) => `${f.get(k) ?? ""}`.trim();
				const version = text("termsVersion");
				if (
					current.termsVersion &&
					version !== current.termsVersion &&
					!confirm("改动协议版本后,所有 User 下次登录时都须重新同意,确定吗?")
				) {
					return;
				}
				onSave({
					passwordLogin,
					requirePhone,
					dailySendLimit: Number(text("dailySendLimit")),
					termsUrl: text("termsUrl"),
					privacyUrl: text("privacyUrl"),
					termsVersion: version,
					auditRetentionDays: Number(text("auditRetentionDays")),
				});
			}}
		>
			<div className="grid gap-1.5">
				<Label>密码登录</Label>
				<Select
					value={passwordLogin}
					disabled={!editable}
					onValueChange={(v) => setPasswordLogin(v as Policy["passwordLogin"])}
				>
					<SelectTrigger aria-label="密码登录">
						<SelectValue>
							{(v: Policy["passwordLogin"]) => passwordModes[v]}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{Object.entries(passwordModes).map(([k, label]) => (
							<SelectItem key={k} value={k}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-xs">
					关闭期间,已设的密码保留但不能用
				</p>
			</div>
			<div className="flex items-center gap-2 self-start pt-7">
				<Switch
					id="requirePhone"
					checked={requirePhone}
					disabled={!editable}
					onCheckedChange={setRequirePhone}
				/>
				<Label htmlFor="requirePhone">必须绑定手机号</Label>
			</div>
			<PolicyField label="每日发送上限(条)" help="全实例每天最多发送的验证码">
				<Input
					id="dailySendLimit"
					name="dailySendLimit"
					type="number"
					min={0}
					required
					disabled={!editable}
					defaultValue={current.dailySendLimit}
				/>
			</PolicyField>
			<PolicyField label="审计保留期(天)">
				<Input
					id="auditRetentionDays"
					name="auditRetentionDays"
					type="number"
					min={1}
					required
					disabled={!editable}
					defaultValue={current.auditRetentionDays}
				/>
			</PolicyField>
			<PolicyField label="《用户协议》URL">
				<Input
					id="termsUrl"
					name="termsUrl"
					type="url"
					disabled={!editable}
					defaultValue={current.termsUrl}
				/>
			</PolicyField>
			<PolicyField label="《隐私政策》URL">
				<Input
					id="privacyUrl"
					name="privacyUrl"
					type="url"
					disabled={!editable}
					defaultValue={current.privacyUrl}
				/>
			</PolicyField>
			<PolicyField
				label="协议版本"
				help="登录时须勾选同意;改动后 User 下次登录须重新同意。留空则不要求同意"
			>
				<Input
					id="termsVersion"
					name="termsVersion"
					maxLength={64}
					disabled={!editable}
					defaultValue={current.termsVersion}
				/>
			</PolicyField>
			{error && (
				<p className="text-destructive text-sm sm:col-span-2">{error}</p>
			)}
			{editable && (
				<div className="sm:col-span-2">
					<Button type="submit" disabled={saving}>
						保存
					</Button>
				</div>
			)}
		</form>
	);
}

function PolicyField({
	label,
	help,
	children,
}: {
	label: string;
	help?: string;
	children: React.ReactElement<{ id: string }>;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={children.props.id}>{label}</Label>
			{children}
			{help && <p className="text-muted-foreground text-xs">{help}</p>}
		</div>
	);
}

function SigningKeys() {
	const can = useCan();
	const client = useQueryClient();
	const keys = useQuery({
		queryKey: ["signing-keys"],
		queryFn: () => api<{ keys: SigningKey[] }>("/signing-keys"),
	});
	const rotate = useMutation({
		mutationFn: () => api("/signing-keys/rotate", { method: "POST" }),
		onSuccess: () => client.invalidateQueries({ queryKey: ["signing-keys"] }),
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>签名密钥</CardTitle>
				<p className="text-muted-foreground text-sm">
					当前密钥签发令牌;轮换后,上一个密钥只用来验证它签过的令牌。
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				{keys.error && (
					<p className="text-destructive text-sm">{keys.error.message}</p>
				)}
				<ul className="space-y-2 text-sm">
					{keys.data?.keys.map((k) => (
						<li key={k.kid} className="flex items-center gap-3">
							<span className="font-mono">{k.kid}</span>
							<span className="text-muted-foreground text-xs">
								{k.current ? "当前" : "已退役"} · 创建于 {date(k.createdAt)}
							</span>
						</li>
					))}
				</ul>
				{rotate.error && (
					<p className="text-destructive text-sm">{rotate.error.message}</p>
				)}
				{can("keys:rotate") && (
					<Button
						variant="outline"
						disabled={rotate.isPending}
						onClick={() => {
							if (
								confirm(
									"轮换后,更早的密钥将被删除,它签发且未过期的令牌随即失效。确定吗?",
								)
							) {
								rotate.mutate();
							}
						}}
					>
						轮换
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

function Channels() {
	const channels = useQuery({
		queryKey: ["channels"],
		queryFn: () =>
			api<{ plugins: ChannelPlugin[]; channels: ChannelSettings[] }>(
				"/channels",
			),
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>通道</CardTitle>
				<p className="text-muted-foreground text-sm">
					把验证码送到手机号或邮箱;每类只启用一个。
				</p>
			</CardHeader>
			<CardContent className="space-y-6">
				{channels.error && (
					<p className="text-destructive text-sm">{channels.error.message}</p>
				)}
				{channels.data &&
					kinds.map((k) => (
						<Channel
							key={k.kind}
							{...k}
							plugins={channels.data.plugins.filter((p) =>
								p.kinds.includes(k.kind),
							)}
							current={channels.data.channels.find((c) => c.kind === k.kind)}
						/>
					))}
			</CardContent>
		</Card>
	);
}

function Channel({
	kind,
	label,
	placeholder,
	plugins,
	current,
}: {
	kind: "phone" | "email";
	label: string;
	placeholder: string;
	plugins: ChannelPlugin[];
	current?: ChannelSettings;
}) {
	const can = useCan();
	const editable = can("config:write");
	const client = useQueryClient();
	const [pluginKey, setPluginKey] = useState(current?.plugin ?? "");
	const plugin = plugins.find((p) => p.key === pluginKey);
	// Stored values belong to the stored plugin only.
	const stored = current?.plugin === pluginKey ? current : undefined;
	const refresh = () => client.invalidateQueries({ queryKey: ["channels"] });

	const save = useMutation({
		mutationFn: (config: Record<string, string>) =>
			api(`/channels/${kind}`, {
				method: "PUT",
				body: { plugin: pluginKey, config },
			}),
		onSuccess: refresh,
	});
	const remove = useMutation({
		mutationFn: () => api(`/channels/${kind}`, { method: "DELETE" }),
		onSuccess: () => {
			setPluginKey("");
			return refresh();
		},
	});
	const test = useMutation({
		mutationFn: (to: string) =>
			api<{ code: string }>(`/channels/${kind}/test`, {
				method: "POST",
				body: { to },
			}),
	});

	return (
		<section className="space-y-4 rounded-lg border p-4">
			<div className="flex items-center gap-3">
				<h3 className="font-medium">{label}</h3>
				<span className="text-muted-foreground text-xs">
					{current ? `已启用 · 更新于 ${date(current.updatedAt)}` : "未启用"}
				</span>
				<div className="ml-auto">
					<Select
						value={pluginKey}
						disabled={!editable}
						onValueChange={(v) => {
							setPluginKey(`${v ?? ""}`);
							save.reset();
						}}
					>
						<SelectTrigger className="w-48" aria-label={`${label} Channel`}>
							<SelectValue>
								{(v: string) =>
									plugins.find((p) => p.key === v)?.name ?? "选择 Channel"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{plugins.map((p) => (
								<SelectItem key={p.key} value={p.key}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{plugin && (
				<form
					key={`${pluginKey}-${current?.updatedAt}`}
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						save.mutate(
							Object.fromEntries(
								plugin.fields.map((f) => [f.key, `${form.get(f.key) ?? ""}`]),
							),
						);
					}}
				>
					{plugin.fields.map((f) => {
						const setAt = stored?.secrets[f.key];
						return (
							<div key={f.key} className="grid gap-1.5">
								<Label htmlFor={`${kind}-${f.key}`}>
									{f.label}
									{f.optional && (
										<span className="text-muted-foreground text-xs">选填</span>
									)}
								</Label>
								<Input
									id={`${kind}-${f.key}`}
									name={f.key}
									type={f.secret ? "password" : f.type}
									autoComplete={f.secret ? "new-password" : "off"}
									disabled={!editable}
									required={!f.optional && !(f.secret && setAt)}
									defaultValue={f.secret ? "" : stored?.config[f.key]}
									placeholder={
										setAt ? `已设置 · 更新于 ${date(setAt)},留空不修改` : ""
									}
								/>
								{f.help && (
									<p className="text-muted-foreground text-xs">{f.help}</p>
								)}
							</div>
						);
					})}
					{save.error && (
						<p className="text-destructive text-sm">{save.error.message}</p>
					)}
					{editable && (
						<div className="flex gap-2">
							<Button type="submit" disabled={save.isPending}>
								{current && !stored ? "切换并保存" : "保存"}
							</Button>
							{current && (
								<Button
									type="button"
									variant="outline"
									disabled={remove.isPending}
									onClick={() => {
										if (confirm(`停用后将无法发送${label}验证码,确定吗?`)) {
											remove.mutate();
										}
									}}
								>
									停用
								</Button>
							)}
						</div>
					)}
				</form>
			)}

			{editable && current && (
				<form
					className="flex flex-wrap items-center gap-2 border-t pt-4"
					onSubmit={(e) => {
						e.preventDefault();
						test.mutate(`${new FormData(e.currentTarget).get("to") ?? ""}`);
					}}
				>
					<Input
						name="to"
						type={kind === "email" ? "email" : "tel"}
						required
						placeholder={placeholder}
						className="w-64"
					/>
					<Button type="submit" variant="outline" disabled={test.isPending}>
						发送测试码
					</Button>
					{test.data && (
						<span className="text-sm">
							已发送 <span className="font-mono">{test.data.code}</span>
							,请核对收到的验证码
						</span>
					)}
					{test.error && (
						<span className="text-destructive text-sm">
							{test.error.message}
						</span>
					)}
				</form>
			)}
		</section>
	);
}
