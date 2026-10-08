import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	ConfirmDialog,
	InlineWarning,
	SectionHeading,
} from "#/components/console";
import { Button } from "#/components/ui/button";
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
import { sendsNothing, smsLocked } from "#/lib/login";
import { useCan } from "../console";
import { PolicyNumber, usePolicy } from "./policy";

export const channelsQuery = queryOptions({
	queryKey: ["channels"],
	queryFn: () =>
		api<{ plugins: ChannelPlugin[]; channels: ChannelSettings[] }>("/channels"),
});

// toChannels links to the 通道 Tab from a hint that needs a channel.
export const toChannels = {
	label: "去设置通道",
	to: "/console/settings",
	search: { tab: "channels" },
} as const;

// lose is what users can't do while the kind has no channel.
const kinds = [
	{
		kind: "phone",
		label: "短信",
		placeholder: "+8613800001111",
		lose: "用户不能用手机号收验证码登录，也不能绑定手机号。",
	},
	{
		kind: "email",
		label: "邮件",
		placeholder: "you@example.com",
		lose: "用户不能用邮箱收验证码登录。",
	},
] as const;

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

export function ChannelsTab() {
	return (
		<div className="space-y-10">
			<Channels />
			<PolicyNumber
				title="每日发送上限"
				field="dailySendLimit"
				label="每天最多发送"
				suffix="条"
				help="认证服务每天最多发出这么多条验证码，防止短信被盗刷。达到上限后，当天不再发送。"
				min={0}
				outline
				warning={(n) =>
					sendsNothing(n) && (
						<InlineWarning>
							设为 0 后所有验证码都不再发送，包括登录和绑定手机号。
						</InlineWarning>
					)
				}
			/>
		</div>
	);
}

function Channels() {
	const channels = useQuery(channelsQuery);
	return (
		<section>
			<SectionHeading
				title="验证码通道"
				intro="认证服务通过它们把验证码发到手机号或邮箱。短信和邮件各启用一个服务商。"
			/>
			<div className="mt-4 divide-y divide-border">
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
							// One solid save per screen: SMS once it is set up, email until then.
							solid={
								channels.data.channels.some((c) => c.kind === "phone") ===
								(k.kind === "phone")
							}
						/>
					))}
			</div>
		</section>
	);
}

function Channel({
	kind,
	label,
	placeholder,
	lose,
	plugins,
	current,
	solid,
}: {
	kind: "phone" | "email";
	label: string;
	placeholder: string;
	lose: string;
	plugins: ChannelPlugin[];
	current?: ChannelSettings;
	solid: boolean; // whether this save is the screen's one solid button
}) {
	const can = useCan();
	const editable = can("config:write");
	const { policy } = usePolicy();
	// Until the policy loads, assume the lock so SMS can't slip out.
	const needed = smsLocked(kind, policy.data?.requirePhone ?? true);
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

	const stopButton = (
		<Button type="button" variant="outline" disabled={remove.isPending}>
			停用
		</Button>
	);
	return (
		<div className="space-y-4 py-6 first:pt-0 last:pb-0">
			<div className="flex items-center gap-3">
				<h3 className="font-medium text-sm">{label}</h3>
				<span className="text-muted-foreground text-xs">
					{current ? `已启用 · 更新于 ${date(current.updatedAt)}` : "未启用"}
				</span>
			</div>
			<p className="text-[13px] text-muted-foreground">没开启时，{lose}</p>
			<div>
				<Select
					value={pluginKey}
					disabled={!editable}
					onValueChange={(v) => {
						setPluginKey(`${v ?? ""}`);
						save.reset();
					}}
				>
					<SelectTrigger className="w-48" aria-label={`${label}服务商`}>
						<SelectValue>
							{(v: string) =>
								plugins.find((p) => p.key === v)?.name ?? "选择服务商"
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
							<div key={f.key} className="grid gap-2">
								<Label htmlFor={`${kind}-${f.key}`} className="text-[13px]">
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
									<p className="text-[13px] text-muted-foreground">{f.help}</p>
								)}
							</div>
						);
					})}
					{save.error && (
						<p className="text-destructive text-sm">{save.error.message}</p>
					)}
					{editable && (
						<div className="flex gap-2">
							<Button
								type="submit"
								variant={solid ? "default" : "outline"}
								disabled={save.isPending}
							>
								{current && !stored ? "切换并保存" : "保存"}
							</Button>
							{current &&
								(needed ? (
									<ConfirmDialog
										trigger={stopButton}
										title={`停用${label}通道？`}
									>
										先在登录方式里关闭必须绑定手机号。开着它时停用短信，没有手机号的用户收不到绑定验证码，就登录不进来。{" "}
										<Link to="/console/settings" className="underline">
											去登录方式
										</Link>
									</ConfirmDialog>
								) : (
									<ConfirmDialog
										trigger={stopButton}
										title={`停用${label}通道？`}
										action={`停用${label}通道`}
										onConfirm={() => remove.mutate()}
									>
										停用后，{lose}
									</ConfirmDialog>
								))}
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
						发送测试验证码
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
		</div>
	);
}
