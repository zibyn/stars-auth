import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { type AuditEvent, api } from "#/lib/console-api";

const search = z.object({
	event: z.string().optional(),
	sub: z.string().optional(),
	since: z.string().optional(), // yyyy-mm-dd, local
	until: z.string().optional(), // yyyy-mm-dd, local, inclusive
});

export const Route = createFileRoute("/console/audit")({
	validateSearch: search,
	component: Audit,
});

// Names of the audit events; other Management API writes are logged under
// their operation id.
export const eventLabel: Record<string, string> = {
	"user.disabled": "禁用 User",
	"user.enabled": "恢复 User",
	"user.deleted": "删除 User",
	"identifier.replaced": "替换 Identifier",
	"session.ended": "下线 Session",
	"roles.assigned": "分配 Role",
	"settings.updated": "修改登录策略",
	"keys.rotated": "轮换签名密钥",
	"login.password_locked": "密码登录锁定",
	"login.ip_locked": "IP 锁定",
	"refresh_token.reused": "refresh token 重放",
	"send.daily_cap_reached": "触发每日发送上限",
	"put-api": "保存 API",
	"delete-api": "删除 API",
	"put-permission": "保存 Permission",
	"delete-permission": "删除 Permission",
	"put-role": "保存 Role",
	"delete-role": "删除 Role",
	"create-application": "注册 Application",
	"update-application": "修改 Application",
	"delete-application": "删除 Application",
	"new-application-secret": "重置 client secret",
	"put-channel": "配置通道",
	"delete-channel": "关闭通道",
	"test-channel": "发送测试码",
};

const pageSize = 50;
const date = (s: string) => new Date(s).toLocaleString("zh-CN");
// day turns a local yyyy-mm-dd into the instant it starts, days later.
const day = (s: string, days = 0) => {
	const d = new Date(`${s}T00:00`);
	d.setDate(d.getDate() + days);
	return d.toISOString();
};

function Audit() {
	const { event = "", sub = "", since = "", until = "" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const events = useInfiniteQuery({
		queryKey: ["audit", event, sub, since, until],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			api<{ events: AuditEvent[] }>(
				`/audit?${new URLSearchParams({
					event,
					sub,
					limit: `${pageSize}`,
					...(since && { since: day(since) }),
					...(until && { until: day(until, 1) }),
					...(pageParam && { before: `${pageParam}` }),
				})}`,
			),
		getNextPageParam: (last) =>
			last.events.length === pageSize ? last.events.at(-1)?.id : undefined,
	});
	const rows = events.data?.pages.flatMap((p) => p.events) ?? [];
	const set = (k: keyof z.infer<typeof search>, v: string) =>
		navigate({ search: (s) => ({ ...s, [k]: v || undefined }) });

	return (
		<Card>
			<CardHeader>
				<CardTitle>审计日志</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap gap-2">
					<Select
						value={event}
						onValueChange={(v) => set("event", `${v ?? ""}`)}
					>
						<SelectTrigger className="w-48">
							<SelectValue>
								{(v: string) => (v ? (eventLabel[v] ?? v) : "全部事件")}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">全部事件</SelectItem>
							{Object.entries(eventLabel).map(([k, label]) => (
								<SelectItem key={k} value={k}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<form
						className="flex-1"
						onSubmit={(e) => {
							e.preventDefault();
							set(
								"sub",
								`${new FormData(e.currentTarget).get("sub") ?? ""}`.trim(),
							);
						}}
					>
						<Input
							key={sub}
							name="sub"
							defaultValue={sub}
							placeholder="User 或操作人的 sub,回车确认"
						/>
					</form>
					<Input
						type="date"
						className="w-40"
						aria-label="起始日期"
						value={since}
						onChange={(e) => set("since", e.target.value)}
					/>
					<Input
						type="date"
						className="w-40"
						aria-label="截止日期"
						value={until}
						onChange={(e) => set("until", e.target.value)}
					/>
				</div>
				<EventTable events={rows} empty={events.isSuccess} />
				{events.error && (
					<p className="text-destructive text-sm">{events.error.message}</p>
				)}
				{events.hasNextPage && (
					<Button
						variant="outline"
						disabled={events.isFetchingNextPage}
						onClick={() => events.fetchNextPage()}
					>
						加载更多
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

export function EventTable({
	events,
	empty,
}: {
	events: AuditEvent[];
	empty: boolean;
}) {
	return (
		<div className="overflow-hidden rounded-lg border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>时间</TableHead>
						<TableHead>事件</TableHead>
						<TableHead>User</TableHead>
						<TableHead>详情</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{events.map((ev) => {
						const { by, ...rest } = ev.detail;
						return (
							<TableRow key={ev.id}>
								<TableCell className="whitespace-nowrap text-muted-foreground">
									{date(ev.at)}
								</TableCell>
								<TableCell>{eventLabel[ev.event] ?? ev.event}</TableCell>
								<TableCell className="font-mono text-xs">
									{ev.sub ?? "—"}
								</TableCell>
								<TableCell className="text-muted-foreground text-xs">
									{by ? (
										<div className="font-mono">操作人 {String(by)}</div>
									) : null}
									{Object.entries(rest)
										.map(
											([k, v]) =>
												`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
										)
										.join(" · ")}
								</TableCell>
							</TableRow>
						);
					})}
					{empty && events.length === 0 && (
						<TableRow>
							<TableCell
								colSpan={4}
								className="text-center text-muted-foreground"
							>
								没有匹配的事件
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
