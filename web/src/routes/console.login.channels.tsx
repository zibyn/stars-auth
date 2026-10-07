import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog } from "#/components/console";
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
	api,
	type ChannelPlugin,
	type ChannelSettings,
} from "#/lib/console-api";
import { useCan } from "./console";
import { PolicyNumber } from "./console.login";

export const Route = createFileRoute("/console/login/channels")({
	component: ChannelsPage,
});

const kinds = [
	{ kind: "phone", label: "短信", placeholder: "+8613800001111" },
	{ kind: "email", label: "邮件", placeholder: "you@example.com" },
] as const;

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

function ChannelsPage() {
	return (
		<>
			<Channels />
			<PolicyNumber
				title="每日发送上限"
				field="dailySendLimit"
				label="每日发送上限(条)"
				help="全实例每天最多发送的验证码"
				min={0}
			/>
		</>
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
								<ConfirmDialog
									trigger={
										<Button
											type="button"
											variant="outline"
											disabled={remove.isPending}
										>
											停用
										</Button>
									}
									title={`停用${label}通道？`}
									action={`停用${label}通道`}
									onConfirm={() => remove.mutate()}
								>
									停用后将无法发送{label}验证码。
								</ConfirmDialog>
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
