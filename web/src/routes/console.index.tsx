import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "#/components/console";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ownCount } from "#/lib/apps";
import { type AuditEvent, api, type Overview } from "#/lib/console-api";
import { checklist, checklistDone, showChecklist } from "#/lib/overview";
import { meQuery, useCan } from "./console";
import { apisQuery } from "./console.apis.index";
import { applicationsQuery } from "./console.apps.index";
import { EventTable } from "./console.audit";
import { channelsQuery } from "./console.login";

export const Route = createFileRoute("/console/")({ component: Home });

type Stat = { label: string; value?: number; hint?: string };

function Home() {
	const can = useCan();
	const o = useQuery({
		queryKey: ["overview"],
		queryFn: () => api<Overview>("/overview"),
	}).data;
	const apps = useQuery({
		...applicationsQuery,
		enabled: can("applications:read"),
	}).data;
	// 应用 counts only your own, so it needs the list; without
	// applications:read the figure isn't shown.
	const stats: Stat[] = o
		? [
				{ label: "用户", value: o.users },
				{
					label: "今日新登录",
					value: o.loginsToday,
					hint: "今天新建的会话数",
				},
				{ label: "活跃会话", value: o.liveSessions },
			]
		: [];
	if (o && can("applications:read")) {
		stats.push({ label: "应用", value: apps && ownCount(apps.applications) });
	}
	return (
		<>
			{o && o.sendsLastDay >= o.dailySendLimit && (
				<p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
					过去 24 小时已发送 {o.sendsLastDay} 条验证码,达到每日上限{" "}
					{o.dailySendLimit},已停发。可在「通道」中调整上限。
				</p>
			)}
			<Checklist />
			<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
				{stats.map(({ label, value, hint }) => (
					<Card key={label}>
						<CardHeader>
							<CardTitle
								className="font-normal text-muted-foreground text-sm"
								title={hint}
							>
								{hint ? (
									<span className="underline decoration-dotted underline-offset-4">
										{label}
									</span>
								) : (
									label
								)}
							</CardTitle>
						</CardHeader>
						<CardContent className="font-semibold text-3xl">
							{value ?? "–"}
						</CardContent>
					</Card>
				))}
			</div>
			{can("audit:read") && <Recent />}
		</>
	);
}

// Closing the checklist, or finishing it, is remembered in this browser
// only.
const closedKey = "console.checklist.closed";
const readClosed = () => {
	try {
		return localStorage.getItem(closedKey) === "1";
	} catch {
		return false;
	}
};
const rememberClosed = () => {
	try {
		localStorage.setItem(closedKey, "1");
	} catch {}
};

function Checklist() {
	const can = useCan();
	const me = useQuery(meQuery).data;
	const [closed, setClosed] = useState(readClosed);
	const channels = useQuery({
		...channelsQuery,
		enabled: can("config:read"),
	}).data;
	const apps = useQuery({
		...applicationsQuery,
		enabled: can("applications:read"),
	}).data;
	const apis = useQuery({
		...apisQuery,
		enabled: can("applications:read"),
	}).data;
	const steps = checklist(me?.permissions ?? [], {
		channels: channels?.channels,
		apps: apps?.applications,
		apis: apis?.apis,
	});
	const done = checklistDone(steps);
	useEffect(() => {
		if (done) {
			rememberClosed();
		}
	}, [done]);
	if (!steps || !showChecklist(steps, closed)) {
		return null;
	}
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>上手清单</CardTitle>
				<Button
					variant="ghost"
					size="icon"
					aria-label="关闭上手清单"
					onClick={() => {
						setClosed(true);
						rememberClosed();
					}}
				>
					<X />
				</Button>
			</CardHeader>
			<CardContent>
				<ol className="space-y-2">
					{steps.map((s, i) => (
						<li key={s.label}>
							<Link
								to={s.to}
								className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
							>
								<span
									className={`flex size-6 items-center justify-center rounded-full border text-xs ${s.done ? "border-primary bg-primary text-primary-foreground" : ""}`}
								>
									{s.done ? <Check className="size-3.5" /> : i + 1}
								</span>
								<span className={s.done ? "text-muted-foreground" : ""}>
									{s.label}
								</span>
								{s.done && (
									<span className="text-muted-foreground text-xs">已完成</span>
								)}
							</Link>
						</li>
					))}
				</ol>
			</CardContent>
		</Card>
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
				{events.isSuccess && events.data.events.length === 0 ? (
					<EmptyState title="最近没有事件">
						超过审计保留期的记录已经删除。
					</EmptyState>
				) : (
					<EventTable events={events.data?.events ?? []} empty={false} />
				)}
			</CardContent>
		</Card>
	);
}
