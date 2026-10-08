import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormField } from "#/components/form";
import { Alert, AlertDescription } from "#/components/ui/alert";
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
	termsSchema,
} from "#/lib/login";
import { ConfirmDialog } from "#/routes/console/-components/confirm-dialog";
import { SaveBar, Section } from "#/routes/console/-components/section";
import { ChannelsLink, channelsQuery } from "./channels";
import { usePolicy, useSavePolicy } from "./policy";

const passwordModes = { off: "关闭", admins: "仅管理员", all: "所有用户" };

const codeKinds = [
	{ kind: "phone", label: "手机号", channel: "短信" },
	{ kind: "email", label: "邮箱", channel: "邮件" },
] as const;

export function LoginTab() {
	const { policy, editable } = usePolicy();
	const { channels } = useSuspenseQuery(channelsQuery).data;
	const p = policy;
	const sms = hasChannel(channels, "phone");
	return (
		<div className="space-y-10">
			<CodeLogin channels={channels} />
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
						<Alert key={k.kind} variant="warning">
							<AlertDescription>
								没有启用{k.channel}通道，用户不能用{k.label}收验证码登录。{" "}
								<ChannelsLink />
							</AlertDescription>
						</Alert>
					),
				)}
			</div>
		</section>
	);
}

function PasswordLogin({ current, editable }: SectionProps) {
	const save = useSavePolicy();
	const form = useForm({
		defaultValues: { passwordLogin: current.passwordLogin },
		onSubmit: ({ value }) => save.mutate(value),
	});
	return (
		<Section
			title="密码登录"
			editable={editable}
			form={form}
			footer={editable && <SaveBar save={save} />}
		>
			<form.Field name="passwordLogin">
				{(field) => (
					<FormField
						field={field}
						label="密码登录范围"
						help="用户可以用手机号、邮箱或用户名加密码登录。关闭后，已经设置的密码会保留，但不能用来登录。"
					>
						{({ id }) => (
							<>
								<Select
									value={field.state.value}
									disabled={!editable}
									onValueChange={(v) =>
										field.handleChange(v as Policy["passwordLogin"])
									}
								>
									<SelectTrigger id={id} className="w-48">
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
								{passwordLocksOut(field.state.value) && (
									<Alert variant="warning">
										<AlertDescription>
											只用用户名登录的用户将无法登录，账号中心也不能设置密码。
										</AlertDescription>
									</Alert>
								)}
							</>
						)}
					</FormField>
				)}
			</form.Field>
		</Section>
	);
}

function RequirePhone({
	current,
	editable,
	sms,
}: SectionProps & { sms: boolean }) {
	const save = useSavePolicy();
	const [asking, setAsking] = useState(false);
	const form = useForm({
		defaultValues: { requirePhone: current.requirePhone },
		onSubmit: ({ value }) =>
			asksRequirePhone(current.requirePhone, value.requirePhone)
				? setAsking(true)
				: save.mutate(value),
	});
	return (
		<Section
			title="必须绑定手机号"
			editable={editable}
			form={form}
			footer={editable && <SaveBar save={save} />}
		>
			<form.Field name="requirePhone">
				{(field) => (
					<FormField
						field={field}
						label="必须绑定手机号"
						help="让每个用户都有手机号，方便找回账号和发通知。开启后，没有手机号的用户要先绑定才能登录。"
					>
						{({ id }) => (
							<>
								<Switch
									id={id}
									checked={field.state.value}
									// Without SMS it can only be turned off, never on.
									disabled={!editable || (!sms && !field.state.value)}
									onCheckedChange={field.handleChange}
								/>
								{!sms && (
									<Alert variant="warning">
										<AlertDescription>
											先启用短信通道。没有短信通道，用户收不到绑定手机号的验证码。{" "}
											<ChannelsLink>去启用短信通道</ChannelsLink>
										</AlertDescription>
									</Alert>
								)}
							</>
						)}
					</FormField>
				)}
			</form.Field>
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
	const [pending, setPending] = useState<Partial<Policy>>();
	const form = useForm({
		defaultValues: {
			termsUrl: current.termsUrl,
			privacyUrl: current.privacyUrl,
			termsVersion: current.termsVersion,
		},
		validationLogic: revalidateLogic(),
		validators: { onDynamic: termsSchema },
		onSubmit: ({ value }) => {
			const t = {
				termsUrl: value.termsUrl.trim(),
				privacyUrl: value.privacyUrl.trim(),
				termsVersion: value.termsVersion.trim(),
			};
			if (asksTermsVersion(current.termsVersion, t.termsVersion)) {
				setPending(t);
			} else {
				save.mutate(t);
			}
		},
	});
	return (
		<Section
			title="用户协议"
			editable={editable}
			form={form}
			footer={editable && <SaveBar save={save} />}
		>
			<form.Field name="termsUrl">
				{(field) => (
					<FormField field={field} label="用户协议地址">
						{(control) => (
							<Input
								{...control}
								type="url"
								placeholder="https://example.com/terms"
							/>
						)}
					</FormField>
				)}
			</form.Field>
			<form.Field name="privacyUrl">
				{(field) => (
					<FormField field={field} label="隐私政策地址">
						{(control) => (
							<Input
								{...control}
								type="url"
								placeholder="https://example.com/privacy"
							/>
						)}
					</FormField>
				)}
			</form.Field>
			<form.Field name="termsVersion">
				{(field) => (
					<FormField
						field={field}
						label="协议版本"
						help="用户登录时要勾选同意这一版协议。留空就不要求同意。"
					>
						{(control) => (
							<Input {...control} className="w-48" placeholder="如 2026-10" />
						)}
					</FormField>
				)}
			</form.Field>
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
