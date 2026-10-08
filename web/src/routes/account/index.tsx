import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ItemList } from "#/components/item-list";
import { Star } from "#/components/star";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "#/components/ui/item";
import { UserAvatar } from "#/components/user-avatar";
import {
	APIError,
	api,
	forget,
	logout,
	type Me,
	type Session,
} from "#/lib/account-api";
import { kindName, primaryIdentifier } from "#/lib/users";
import { meQuery } from "#/routes/account/route";
import { Panel } from "#/routes/console/-components/panel";
import { DangerZone, Section } from "#/routes/console/-components/section";

export const Route = createFileRoute("/account/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(sessionsQuery),
	component: Account,
});

const sessionsQuery = queryOptions({
	queryKey: ["account", "sessions"],
	queryFn: () => api<{ sessions: Session[] }>("/sessions"),
});

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

const message = (e: unknown) =>
	e instanceof Error ? e.message : "出错了,请重试";

// Sensitive actions run once the User has authenticated in the last 10
// minutes; otherwise the reauthentication dialog comes first.
type Guard = (action: () => void) => void;

function Account() {
	// The page's own data: bindings and passwords change it in place.
	const user = useSuspenseQuery(meQuery).data;
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<(() => void) | null>(null);
	const [deleted, setDeleted] = useState(false);
	const [exportError, setExportError] = useState("");

	if (deleted) {
		return (
			<main className="flex min-h-svh flex-col items-center justify-center gap-2 bg-canvas px-4 text-center">
				<h1 className="font-semibold text-2xl">账号已注销</h1>
				<p className="text-muted-foreground text-sm">
					你的数据已全部删除。同一个手机号或邮箱再次登录,将是一个新账号。
				</p>
			</main>
		);
	}
	const guard: Guard = (action) => {
		if (new Date(user.recentAuthUntil).getTime() - 5_000 > Date.now()) {
			action();
		} else {
			setPending(() => action);
		}
	};
	const main = primaryIdentifier(user.identifiers);

	return (
		<div className="min-h-svh bg-canvas p-2 text-sm sm:p-6">
			<Panel className="mx-auto max-w-2xl space-y-10 px-6 py-8 sm:px-14 sm:py-11">
				<div className="flex items-center gap-2 font-semibold">
					<Star className="size-5 text-star" />
					Stars
				</div>
				<header className="flex items-center gap-4">
					<UserAvatar name={main} size="lg" />
					<div className="min-w-0">
						<h1 className="truncate font-semibold text-2xl tracking-tight">
							{main ?? user.sub}
						</h1>
						<p className="text-[13px] text-muted-foreground">
							注册于 {date(user.createdAt)}
						</p>
					</div>
					<Button variant="outline" className="ml-auto" onClick={logout}>
						退出登录
					</Button>
				</header>
				<LoginMethods me={user} guard={guard} />
				{user.passwordAllowed && <Security me={user} guard={guard} />}
				<Sessions />
				<Section title="数据与隐私">
					{exportError && (
						<p className="text-[13px] text-destructive">{exportError}</p>
					)}
					<ItemList>
						<Row
							label="导出我的数据"
							hint="登录方式、设备与会话、同意记录和与你相关的安全事件,JSON 格式"
						>
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									guard(() =>
										exportData(user.sub).then(
											() => setExportError(""),
											(e) => setExportError(message(e)),
										),
									)
								}
							>
								导出
							</Button>
						</Row>
					</ItemList>
				</Section>
				<DangerZone title="危险操作">
					<DeleteAccount guard={guard} onDeleted={() => setDeleted(true)} />
				</DangerZone>
			</Panel>
			<Reauth
				me={user}
				open={pending !== null}
				onClose={() => setPending(null)}
				onDone={async () => {
					await queryClient.invalidateQueries(meQuery);
					const action = pending;
					setPending(null);
					action?.();
				}}
			/>
		</div>
	);
}

async function exportData(sub: string) {
	const data = await api<unknown>("/export");
	const a = document.createElement("a");
	a.href = URL.createObjectURL(
		new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
	);
	a.download = `stars-auth-${sub}.json`;
	a.click();
	URL.revokeObjectURL(a.href);
}

function LoginMethods({ me, guard }: { me: Me; guard: Guard }) {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<"phone" | "email" | null>(null);
	const unbind = useMutation({
		mutationFn: (kind: string) =>
			api(`/identifiers/${kind}`, { method: "DELETE" }),
		onSuccess: () => queryClient.invalidateQueries(meQuery),
	});
	const username = me.identifiers.find((i) => i.kind === "username");
	return (
		<Section title="登录方式">
			{unbind.error && (
				<p className="text-[13px] text-destructive">{message(unbind.error)}</p>
			)}
			<ItemList>
				{(["phone", "email"] as const).map((kind) => {
					const id = me.identifiers.find((i) => i.kind === kind);
					return (
						<Row key={kind} label={kindName[kind]} hint={id?.value ?? "未绑定"}>
							{id ? (
								<>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => guard(() => setEditing(kind))}
									>
										更换
									</Button>
									<Button
										variant="ghost"
										size="sm"
										disabled={unbind.isPending}
										onClick={() => guard(() => unbind.mutate(kind))}
									>
										解绑
									</Button>
								</>
							) : (
								<Button
									variant="outline"
									size="sm"
									onClick={() => guard(() => setEditing(kind))}
								>
									绑定
								</Button>
							)}
						</Row>
					);
				})}
				{username && (
					<Row label="用户名" hint={username.value}>
						{null}
					</Row>
				)}
			</ItemList>
			{editing && (
				<BindIdentifier kind={editing} onClose={() => setEditing(null)} />
			)}
		</Section>
	);
}

// BindIdentifier verifies a new phone number or email with a code and binds
// it in place of the User's.
function BindIdentifier({
	kind,
	onClose,
}: {
	kind: "phone" | "email";
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [value, setValue] = useState("");
	const [code, setCode] = useState("");
	const [sent, setSent] = useState(false);
	const send = useMutation({
		mutationFn: () =>
			api(`/identifiers/${kind}/code`, { method: "POST", body: { value } }),
		onSuccess: () => setSent(true),
	});
	const bind = useMutation({
		mutationFn: () =>
			api(`/identifiers/${kind}`, { method: "PUT", body: { value, code } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries(meQuery);
			onClose();
		},
	});
	const error = send.error ?? bind.error;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogTitle>绑定新{kindName[kind]}</DialogTitle>
				<DialogDescription>
					验证码会发到新{kindName[kind]},无需验证原来的。
				</DialogDescription>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						sent ? bind.mutate() : send.mutate();
					}}
				>
					<Input
						type={kind === "phone" ? "tel" : "email"}
						autoComplete={kind === "phone" ? "tel" : "email"}
						placeholder={kind === "phone" ? "+86 手机号" : "邮箱"}
						value={value}
						onChange={(e) => {
							setValue(e.target.value);
							setSent(false);
						}}
						required
					/>
					{sent && (
						<Input
							inputMode="numeric"
							autoComplete="one-time-code"
							placeholder="6 位验证码"
							value={code}
							onChange={(e) => setCode(e.target.value)}
							required
						/>
					)}
					{error && <p className="text-destructive">{message(error)}</p>}
					<div className="flex justify-end gap-2">
						{sent && (
							<Button
								type="button"
								variant="ghost"
								disabled={send.isPending}
								onClick={() => send.mutate()}
							>
								重新发送
							</Button>
						)}
						<Button type="submit" disabled={send.isPending || bind.isPending}>
							{sent ? "确认绑定" : "发送验证码"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function Security({ me, guard }: { me: Me; guard: Guard }) {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const remove = useMutation({
		mutationFn: () => api("/password", { method: "DELETE" }),
		onSuccess: () => queryClient.invalidateQueries(meQuery),
	});
	return (
		<Section title="安全">
			{remove.error && (
				<p className="text-[13px] text-destructive">{message(remove.error)}</p>
			)}
			<ItemList>
				<Row
					label="密码"
					hint={
						me.hasPassword
							? "已设置,可配合手机号、邮箱或用户名登录"
							: "未设置;忘记密码时用验证码登录后在这里修改"
					}
				>
					{me.hasPassword && (
						<Button
							variant="ghost"
							size="sm"
							disabled={remove.isPending}
							onClick={() => guard(() => remove.mutate())}
						>
							删除
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => guard(() => setEditing(true))}
					>
						{me.hasPassword ? "修改" : "设置"}
					</Button>
				</Row>
			</ItemList>
			{editing && <SetPassword onClose={() => setEditing(false)} />}
		</Section>
	);
}

function SetPassword({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const [password, setPassword] = useState("");
	const save = useMutation({
		mutationFn: () => api("/password", { method: "PUT", body: { password } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries(meQuery);
			onClose();
		},
	});
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogTitle>设置密码</DialogTitle>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						save.mutate();
					}}
				>
					<Input
						type="password"
						autoComplete="new-password"
						placeholder="至少 8 位"
						minLength={8}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
					/>
					{save.error && (
						<p className="text-destructive">{message(save.error)}</p>
					)}
					<div className="flex justify-end">
						<Button type="submit" disabled={save.isPending}>
							保存
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function Sessions() {
	const queryClient = useQueryClient();
	const { sessions } = useSuspenseQuery(sessionsQuery).data;
	const end = useMutation({
		mutationFn: (id: string) => api(`/sessions/${id}`, { method: "DELETE" }),
		onSuccess: () => queryClient.invalidateQueries(sessionsQuery),
	});
	return (
		<Section
			title="设备与会话"
			intro="不限设备数,可逐个下线;已结束的保留 30 天"
		>
			<ItemList>
				{sessions.map((s) => (
					<Row
						key={s.id}
						label={
							<span className="flex items-center gap-2">
								{s.kind === "app" ? "App" : "浏览器"} · {s.application}
								{s.current && <Badge>本设备</Badge>}
								{!s.active && <Badge variant="secondary">已结束</Badge>}
							</span>
						}
						hint={`登录于 ${date(s.authTime)} · 最近活动 ${date(s.lastSeenAt)}`}
					>
						{s.active && !s.current && (
							<Button
								variant="ghost"
								size="sm"
								disabled={end.isPending}
								onClick={() => end.mutate(s.id)}
							>
								下线
							</Button>
						)}
					</Row>
				))}
			</ItemList>
		</Section>
	);
}

function DeleteAccount({
	guard,
	onDeleted,
}: {
	guard: Guard;
	onDeleted: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [confirm, setConfirm] = useState("");
	const remove = useMutation({
		mutationFn: () => api("/me", { method: "DELETE" }),
		onSuccess: () => {
			forget();
			onDeleted();
		},
	});
	return (
		<>
			<Row label="注销账号" hint="立即生效,不可恢复">
				<Button
					variant="destructive"
					size="sm"
					onClick={() => guard(() => setOpen(true))}
				>
					注销
				</Button>
			</Row>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogTitle>注销账号</DialogTitle>
					<DialogDescription>
						立即生效,没有冷静期:所有登录方式、设备和数据都会被删除,各应用会收到通知。此操作不可恢复。
					</DialogDescription>
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							remove.mutate();
						}}
					>
						<Input
							placeholder="输入「注销」确认"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
						/>
						{remove.error && (
							<p className="text-destructive">{message(remove.error)}</p>
						)}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setOpen(false)}
							>
								取消
							</Button>
							<Button
								type="submit"
								variant="destructive"
								disabled={confirm !== "注销" || remove.isPending}
							>
								永久注销
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

// Reauth proves the User again with a code to one of their Identifiers, or
// their password.
function Reauth({
	me,
	open,
	onClose,
	onDone,
}: {
	me: Me;
	open: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const codeKinds = me.identifiers
		.map((i) => i.kind)
		.filter((k): k is "phone" | "email" => k !== "username");
	const methods = [
		...codeKinds,
		...(me.hasPassword && me.passwordAllowed ? (["password"] as const) : []),
	];
	const [method, setMethod] = useState<(typeof methods)[number] | undefined>();
	const current = method ?? methods[0];
	const [sent, setSent] = useState(false);
	const [secret, setSecret] = useState("");
	const send = useMutation({
		mutationFn: () =>
			api("/reauth/code", { method: "POST", body: { kind: current } }),
		onSuccess: () => setSent(true),
	});
	const verify = useMutation({
		mutationFn: () =>
			api("/reauth", {
				method: "POST",
				body:
					current === "password"
						? { password: secret }
						: { kind: current, code: secret },
			}),
		onSuccess: () => {
			setSecret("");
			setSent(false);
			onDone();
		},
	});
	const error = send.error ?? verify.error;
	const target = me.identifiers.find((i) => i.kind === current)?.value;
	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogTitle>请重新验证身份</DialogTitle>
				<DialogDescription>
					换绑、解绑、导出和注销,须在 10 分钟内验证过身份。
				</DialogDescription>
				{methods.length > 1 && (
					<div className="flex gap-2">
						{methods.map((m) => (
							<Button
								key={m}
								size="sm"
								variant={m === current ? "secondary" : "ghost"}
								onClick={() => {
									setMethod(m);
									setSent(false);
									setSecret("");
								}}
							>
								{m === "password" ? "密码" : `${kindName[m]}验证码`}
							</Button>
						))}
					</div>
				)}
				{current === undefined ? (
					<p>没有可用的验证方式,请联系管理员。</p>
				) : (
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							current !== "password" && !sent ? send.mutate() : verify.mutate();
						}}
					>
						{current === "password" ? (
							<Input
								type="password"
								autoComplete="current-password"
								placeholder="密码"
								value={secret}
								onChange={(e) => setSecret(e.target.value)}
								required
							/>
						) : (
							<>
								<p className="text-muted-foreground">验证码将发送到 {target}</p>
								{sent && (
									<Input
										inputMode="numeric"
										autoComplete="one-time-code"
										placeholder="6 位验证码"
										value={secret}
										onChange={(e) => setSecret(e.target.value)}
										required
									/>
								)}
							</>
						)}
						{error && (
							<p className="text-destructive">
								{error instanceof APIError && error.status === 403
									? "请重新验证"
									: message(error)}
							</p>
						)}
						<div className="flex justify-end">
							<Button
								type="submit"
								disabled={send.isPending || verify.isPending}
							>
								{current !== "password" && !sent ? "发送验证码" : "验证"}
							</Button>
						</div>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

function Row({
	label,
	hint,
	children,
}: {
	label: React.ReactNode;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<Item>
			<ItemContent className="min-w-0">
				<ItemTitle className="font-normal">{label}</ItemTitle>
				{hint && (
					<ItemDescription className="truncate text-[13px]">
						{hint}
					</ItemDescription>
				)}
			</ItemContent>
			<ItemActions className="shrink-0 gap-1">{children}</ItemActions>
		</Item>
	);
}
