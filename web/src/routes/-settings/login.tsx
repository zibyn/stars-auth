import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	ConfirmDialog,
	Field,
	InlineWarning,
	SaveBar,
	Section,
} from "#/components/console";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import type { ChannelSettings, Policy } from "#/lib/console-api";
import {
	asksRequirePhone,
	asksTermsVersion,
	hasChannel,
	passwordLocksOut,
	termsError,
} from "#/lib/login";
import { channelsQuery, toChannels } from "./channels";
import { usePolicy, useSavePolicy } from "./policy";

const passwordModes = { off: "关闭", admins: "仅管理员", all: "所有用户" };

const codeKinds = [
	{ kind: "phone", label: "手机号", channel: "短信" },
	{ kind: "email", label: "邮箱", channel: "邮件" },
] as const;

export function LoginTab() {
	const { policy, editable } = usePolicy();
	const channels = useQuery(channelsQuery);
	const error = policy.error ?? channels.error;
	if (error) {
		return <p className="text-destructive text-sm">{error.message}</p>;
	}
	if (!policy.data || !channels.data) {
		return null;
	}
	const p = policy.data;
	const sms = hasChannel(channels.data.channels, "phone");
	return (
		<div className="space-y-10">
			<CodeLogin channels={channels.data.channels} />
			<PasswordLogin current={p} editable={editable} />
			<RequirePhone current={p} editable={editable} sms={sms} />
			<Terms current={p} editable={editable} />
		</div>
	);
}

type SectionProps = { current: Policy; editable: boolean };

function CodeLogin({ channels }: { channels: ChannelSettings[] }) {
	return (
		<section>
			<h2 className="font-semibold text-[15px]">验证码登录</h2>
			<div className="mt-4 space-y-3">
				{codeKinds.map((k) =>
					hasChannel(channels, k.kind) ? (
						<p key={k.kind} className="text-sm">
							用户可以用{k.label}收验证码登录。
						</p>
					) : (
						<InlineWarning key={k.kind} link={toChannels}>
							没有启用{k.channel}通道，用户不能用{k.label}收验证码登录。
						</InlineWarning>
					),
				)}
			</div>
		</section>
	);
}

function PasswordLogin({ current, editable }: SectionProps) {
	const save = useSavePolicy();
	const [mode, setMode] = useState(current.passwordLogin);
	return (
		<Section
			title="密码登录"
			editable={editable}
			onSubmit={() => save.mutate({ passwordLogin: mode })}
			footer={editable && <SaveBar save={save} />}
		>
			<Field
				label="密码登录范围"
				help="用户可以用手机号、邮箱或用户名加密码登录。关闭后，已经设置的密码会保留，但不能用来登录。"
			>
				<Select
					value={mode}
					disabled={!editable}
					onValueChange={(v) => setMode(v as Policy["passwordLogin"])}
				>
					<SelectTrigger className="w-48" aria-label="密码登录范围">
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
				{passwordLocksOut(mode) && (
					<InlineWarning>
						只用用户名登录的用户将无法登录，账号中心也不能设置密码。
					</InlineWarning>
				)}
			</Field>
		</Section>
	);
}

function RequirePhone({
	current,
	editable,
	sms,
}: SectionProps & { sms: boolean }) {
	const save = useSavePolicy();
	const [on, setOn] = useState(current.requirePhone);
	const [asking, setAsking] = useState(false);
	// Without SMS it can only be turned off, never on.
	const blocked = !sms && !on;
	return (
		<Section
			title="必须绑定手机号"
			editable={editable}
			onSubmit={() =>
				asksRequirePhone(current.requirePhone, on)
					? setAsking(true)
					: save.mutate({ requirePhone: on })
			}
			footer={editable && <SaveBar save={save} outline />}
		>
			<Field
				label="必须绑定手机号"
				help="让每个用户都有手机号，方便找回账号和发通知。开启后，没有手机号的用户要先绑定才能登录。"
			>
				<Switch
					aria-label="必须绑定手机号"
					checked={on}
					disabled={!editable || blocked}
					onCheckedChange={setOn}
				/>
				{!sms && (
					<InlineWarning link={{ ...toChannels, label: "去启用短信通道" }}>
						先启用短信通道。没有短信通道，用户收不到绑定手机号的验证码。
					</InlineWarning>
				)}
			</Field>
			<ConfirmDialog
				open={asking}
				onOpenChange={setAsking}
				title="开启必须绑定手机号？"
				action="开启必须绑定手机号"
				destructive={false}
				onConfirm={() => save.mutate({ requirePhone: true })}
			>
				没有手机号的用户下次登录时要先绑定才能继续。
			</ConfirmDialog>
		</Section>
	);
}

function Terms({ current, editable }: SectionProps) {
	const save = useSavePolicy();
	const [error, setError] = useState("");
	const [pending, setPending] = useState<Partial<Policy>>();
	return (
		<Section
			title="用户协议"
			editable={editable}
			onSubmit={(f) => {
				const text = (k: string) => `${f.get(k) ?? ""}`.trim();
				const t = {
					termsUrl: text("termsUrl"),
					privacyUrl: text("privacyUrl"),
					termsVersion: text("termsVersion"),
				};
				const err = termsError(t);
				setError(err);
				if (err) {
					return;
				}
				if (asksTermsVersion(current.termsVersion, t.termsVersion)) {
					setPending(t);
				} else {
					save.mutate(t);
				}
			}}
			footer={
				editable && (
					<>
						{error && <p className="text-destructive text-sm">{error}</p>}
						<SaveBar save={save} outline />
					</>
				)
			}
		>
			<Field label="用户协议地址">
				<Input
					name="termsUrl"
					type="url"
					defaultValue={current.termsUrl}
					placeholder="https://example.com/terms"
				/>
			</Field>
			<Field label="隐私政策地址">
				<Input
					name="privacyUrl"
					type="url"
					defaultValue={current.privacyUrl}
					placeholder="https://example.com/privacy"
				/>
			</Field>
			<Field
				label="协议版本"
				help="用户登录时要勾选同意这一版协议。留空就不要求同意。"
			>
				<Input
					name="termsVersion"
					maxLength={64}
					className="w-48"
					defaultValue={current.termsVersion}
					placeholder="如 2026-10"
				/>
			</Field>
			<ConfirmDialog
				open={!!pending}
				onOpenChange={(o) => !o && setPending(undefined)}
				title="更新协议版本？"
				action="更新协议版本"
				destructive={false}
				onConfirm={() => pending && save.mutate(pending)}
			>
				所有用户下次登录都要重新同意。接了直连认证 API 的 App 要带上新版本号。
			</ConfirmDialog>
		</Section>
	);
}
