import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { type AuditEvent, api, type Overview } from "#/lib/console-api";
import { useCan } from "./console";
import { EventTable } from "./console.audit";

export const Route = createFileRoute("/console/")({ component: Home });

function Home() {
	const can = useCan();
	const o = useQuery({
		queryKey: ["overview"],
		queryFn: () => api<Overview>("/overview"),
	}).data;
	const stats = o && [
		["User", o.users],
		["今日登录", o.loginsToday],
		["活跃 Session", o.liveSessions],
		["Application", o.applications],
	];
	return (
		<>
			{o && o.sendsLastDay >= o.dailySendLimit && (
				<p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
					过去 24 小时已发送 {o.sendsLastDay} 条验证码,达到每日上限{" "}
					{o.dailySendLimit},已停发。可在「安全」中调整上限。
				</p>
			)}
			<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
				{stats?.map(([label, n]) => (
					<Card key={label}>
						<CardHeader>
							<CardTitle className="font-normal text-muted-foreground text-sm">
								{label}
							</CardTitle>
						</CardHeader>
						<CardContent className="font-semibold text-3xl">{n}</CardContent>
					</Card>
				))}
			</div>
			{can("audit:read") && <Recent />}
		</>
	);
}

function Recent() {
	const events = useQuery({
		queryKey: ["audit", "recent"],
		queryFn: () => api<{ events: AuditEvent[] }>("/audit?limit=10"),
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					最近事件{" "}
					<Link
						to="/console/audit"
						className="font-normal text-muted-foreground text-sm"
					>
						全部 →
					</Link>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<EventTable
					events={events.data?.events ?? []}
					empty={events.isSuccess}
				/>
			</CardContent>
		</Card>
	);
}
