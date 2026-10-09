import { revalidateLogic, useForm } from "@tanstack/react-form";
import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { CopyButton } from "#/components/copy-button";
import { FormError, FormField, failed, saved } from "#/components/form";
import { ItemList } from "#/components/item-list";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "#/components/ui/item";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { api, type ProviderInfo, type ProviderType } from "#/lib/console-api";
import { disableImpact, providerSchema } from "#/lib/login";
import { ConfirmDialog } from "#/routes/console/-components/confirm-dialog";
import { SectionHeading } from "#/routes/console/-components/section";
import { useCan } from "#/routes/console/route";

export const providersQuery = queryOptions({
	queryKey: ["providers"],
	queryFn: () =>
		api<{ types: ProviderType[]; providers: ProviderInfo[] }>("/providers"),
});

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

// ExternalLogin is the 外部登录 section: the Providers an admin added, each
// a 使用 {名称} 登录 button on the login page (docs/spec/consoles.md).
export function ExternalLogin() {
	const { types, providers } = useSuspenseQuery(providersQuery).data;
	const editable = useCan()("config:write");
	const [adding, setAdding] = useState(false);
	const [typeKey, setTypeKey] = useState("");
	const type = types.find((t) => t.key === typeKey);
	const close = () => {
		setAdding(false);
		setTypeKey("");
	};
	return (
		<section>
			<SectionHeading
				title="外部登录"
				intro="用户可以在登录页用这些账号登录，比如 Google 或公司自建的 Keycloak。第一次用它登录的用户会自动注册。"
			/>
			<div className="mt-4 space-y-4">
				{providers.length > 0 ? (
					<ItemList>
						{providers.map((p) => (
							<Provider
								key={p.id}
								provider={p}
								type={types.find((t) => t.key === p.type)}
								editable={editable}
							/>
						))}
					</ItemList>
				) : (
					!adding && (
						<Empty className="border">
							<EmptyHeader>
								<EmptyTitle>还没有外部登录</EmptyTitle>
								<EmptyDescription>
									添加后，登录页会多一个「使用 {"{名称}"}{" "}
									登录」按钮，用户不用收验证码就能登录。
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								{editable ? (
									<Button size="sm" onClick={() => setAdding(true)}>
										添加外部登录
									</Button>
								) : (
									<span className="text-muted-foreground">
										需要「管理员」角色才能添加。
									</span>
								)}
							</EmptyContent>
						</Empty>
					)
				)}
				{editable && providers.length > 0 && !adding && (
					<Button variant="outline" onClick={() => setAdding(true)}>
						添加外部登录
					</Button>
				)}
				{adding && (
					<div className="space-y-4 rounded-xl border p-6">
						<Field>
							<FieldLabel>Provider 类型</FieldLabel>
							<Select
								value={typeKey}
								onValueChange={(v) => setTypeKey(`${v ?? ""}`)}
							>
								<SelectTrigger className="w-48" aria-label="Provider 类型">
									<SelectValue>
										{(v: string) =>
											types.find((t) => t.key === v)?.name ?? "选择类型"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{types.map((t) => (
										<SelectItem key={t.key} value={t.key}>
											{t.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						{type ? (
							<ProviderForm key={type.key} type={type} onDone={close} />
						) : (
							<Button type="button" variant="outline" onClick={close}>
								取消
							</Button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

function Provider({
	provider: p,
	type,
	editable,
}: {
	provider: ProviderInfo;
	type?: ProviderType;
	editable: boolean;
}) {
	const client = useQueryClient();
	const [editing, setEditing] = useState(false);
	const act = useMutation({
		mutationFn: (a: {
			method: "POST" | "DELETE";
			path: string;
			what: string;
		}) =>
			api(`/providers/${encodeURIComponent(p.id)}${a.path}`, {
				method: a.method,
			}),
		onSuccess: () => client.invalidateQueries({ queryKey: ["providers"] }),
		onError: (e, a) => failed(a.what)(e),
	});
	return (
		<Item className="flex-col items-stretch gap-4 py-5">
			<div className="flex flex-wrap items-center gap-4">
				<ItemContent>
					<ItemTitle>
						{p.name}
						{p.enabled ? (
							<Badge variant="success">已启用</Badge>
						) : (
							<Badge variant="secondary">已停用</Badge>
						)}
					</ItemTitle>
					<ItemDescription className="text-[13px]">
						{type?.name ?? p.type} · <span className="font-mono">{p.id}</span> ·{" "}
						{p.bound} 个用户已绑定
					</ItemDescription>
				</ItemContent>
				{editable && (
					<ItemActions>
						<Button
							size="sm"
							variant="ghost"
							disabled={!type}
							onClick={() => setEditing(!editing)}
						>
							{editing ? "收起" : "编辑"}
						</Button>
						{p.enabled ? (
							<ConfirmDialog
								trigger={
									<Button size="sm" variant="ghost" disabled={act.isPending}>
										停用
									</Button>
								}
								title={`停用 ${p.name}？`}
								action="停用外部登录"
								onConfirm={() =>
									act.mutate({
										method: "POST",
										path: "/disable",
										what: "停用外部登录失败",
									})
								}
							>
								登录页不再显示「使用 {p.name} 登录」。{disableImpact(p)}
							</ConfirmDialog>
						) : (
							<Button
								size="sm"
								variant="ghost"
								disabled={act.isPending}
								onClick={() =>
									act.mutate({
										method: "POST",
										path: "/enable",
										what: "启用外部登录失败",
									})
								}
							>
								启用
							</Button>
						)}
						{/* With bindings it can only be disabled (#87 story 5). */}
						{p.bound === 0 && (
							<ConfirmDialog
								trigger={
									<Button
										size="sm"
										variant="ghost"
										className="text-destructive"
										disabled={act.isPending}
									>
										删除
									</Button>
								}
								title={`删除 ${p.name}？`}
								action="删除外部登录"
								onConfirm={() =>
									act.mutate({
										method: "DELETE",
										path: "",
										what: "删除外部登录失败",
									})
								}
							>
								登录页不再显示这个按钮，它的设置一并删除。之后要用得重新添加，回调
								URL 不变。
							</ConfirmDialog>
						)}
					</ItemActions>
				)}
			</div>
			{editing && type && (
				<ProviderForm
					key={`${p.id}-${JSON.stringify(p.secrets)}`}
					type={type}
					current={p}
					onDone={() => setEditing(false)}
				/>
			)}
		</Item>
	);
}

// ProviderForm adds a Provider of type, or edits current. The ID and the
// type's immutable fields (the issuer) are set only when adding; a secret
// already set shows empty and stays unless retyped.
function ProviderForm({
	type,
	current,
	onDone,
}: {
	type: ProviderType;
	current?: ProviderInfo;
	onDone: () => void;
}) {
	const client = useQueryClient();
	const fields = type.fields ?? [];
	const save = useMutation({
		mutationFn: (v: {
			id: string;
			name: string;
			config: Record<string, string>;
		}) =>
			current
				? api(`/providers/${encodeURIComponent(current.id)}`, {
						method: "PUT",
						body: { name: v.name, config: v.config },
					})
				: api("/providers", { method: "POST", body: { ...v, type: type.key } }),
		onSuccess: () => {
			saved();
			onDone();
			return client.invalidateQueries({ queryKey: ["providers"] });
		},
	});
	const form = useForm({
		defaultValues: {
			id: current?.id ?? "",
			name: current?.name ?? "",
			config: Object.fromEntries(
				fields.map((f) => [
					f.key,
					f.secret ? "" : (current?.config[f.key] ?? ""),
				]),
			),
		},
		validationLogic: revalidateLogic(),
		validators: {
			onDynamic: providerSchema(fields, current?.secrets ?? {}, !current),
		},
		onSubmit: ({ value }) =>
			save.mutate({
				id: value.id.trim(),
				name: value.name.trim(),
				config: Object.fromEntries(
					Object.entries(value.config).map(([k, v]) => [k, v.trim()]),
				),
			}),
	});
	return (
		<form
			noValidate
			className="space-y-4"
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<FieldGroup className="gap-4">
				<form.Field name="id">
					{(field) => (
						<FormField
							field={field}
							label="Provider ID"
							help="出现在回调 URL 里，添加后不能修改。"
						>
							{(control) => (
								<Input
									{...control}
									className="w-64 font-mono"
									disabled={!!current}
									placeholder="google"
								/>
							)}
						</FormField>
					)}
				</form.Field>
				<form.Subscribe selector={(s) => s.values.id}>
					{(id) => {
						const url =
							current?.callbackUrl ??
							`${location.origin}/login/providers/${id.trim() || "{Provider ID}"}/callback`;
						return (
							<Field>
								<FieldLabel>回调 URL</FieldLabel>
								<div className="flex flex-wrap items-center gap-2">
									<span className="break-all font-mono text-sm">{url}</span>
									<CopyButton value={url} />
								</div>
								<p className="text-[13px] text-muted-foreground">
									填进上游的后台，作为允许的重定向地址。
								</p>
							</Field>
						);
					}}
				</form.Subscribe>
				<form.Field name="name">
					{(field) => (
						<FormField
							field={field}
							label="名称"
							help="登录页按钮显示为「使用 {名称} 登录」。"
						>
							{(control) => (
								<Input {...control} className="w-64" placeholder="Google" />
							)}
						</FormField>
					)}
				</form.Field>
				{fields.map((f) => {
					const setAt = current?.secrets[f.key];
					return (
						<form.Field key={f.key} name={`config.${f.key}`}>
							{(field) => (
								<FormField
									field={field}
									label={f.label}
									en={f.optional ? "选填" : undefined}
									help={
										f.immutable
											? `${f.help ? `${f.help}。` : ""}添加后不能修改。`
											: f.help
									}
								>
									{(control) => (
										<Input
											{...control}
											type={f.secret ? "password" : f.type}
											autoComplete={f.secret ? "new-password" : "off"}
											disabled={!!current && f.immutable}
											placeholder={
												setAt ? `已设置 · 更新于 ${date(setAt)},留空不修改` : ""
											}
										/>
									)}
								</FormField>
							)}
						</form.Field>
					);
				})}
			</FieldGroup>
			<FormError error={save.error} />
			<div className="flex gap-2">
				<Button type="submit" disabled={save.isPending}>
					{current ? "保存" : "添加"}
				</Button>
				<Button type="button" variant="outline" onClick={onDone}>
					取消
				</Button>
			</div>
		</form>
	);
}
