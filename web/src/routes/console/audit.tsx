import {
	infiniteQueryOptions,
	useQuery,
	useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	stripSearchParams,
	useNavigate,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { ItemList } from "#/components/item-list";
import { Star } from "#/components/star";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Item, ItemContent, ItemMedia } from "#/components/ui/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
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
import { UserAvatar } from "#/components/user-avatar";
import {
	actor,
	describe,
	doneBy,
	eventGroups,
	eventName,
	findUser,
	type Part,
} from "#/lib/audit";
import { type AuditEvent, api, type User } from "#/lib/console-api";
import { primaryIdentifier } from "#/lib/users";
import { apisQuery } from "#/routes/console/apis/index";
import { applicationsQuery } from "#/routes/console/apps/index";
import { useCan } from "#/routes/console/route";

const text = z.string().default("").catch("");
const search = z.object({
	event: text,
	sub: text,
	q: text, // what was typed to find sub, shown back
	since: text, // yyyy-mm-dd, local
	until: text, // yyyy-mm-dd, local, inclusive
});
const defaults = { event: "", sub: "", q: "", since: "", until: "" };

export const Route = createFileRoute("/console/audit")({
	staticData: { useHeader: () => ({ title: "审计日志" }) },
	validateSearch: search,
	search: { middlewares: [stripSearchParams(defaults)] },
	// q only echoes what was typed: it doesn't change the events.
	loaderDeps: ({ search: { q, ...deps } }) => deps,
	loader: ({ context, deps }) =>
		context.queryClient.ensureInfiniteQueryData(eventsQuery(deps)),
	component: Audit,
});

const pageSize = 50;
const date = (s: string) => new Date(s).toLocaleString("zh-CN");
// day turns a local yyyy-mm-dd into the instant it starts, days later.
const day = (s: string, days = 0) => {
	const d = new Date(`${s}T00:00`);
	d.setDate(d.getDate() + days);
	return d.toISOString();
};

const eventsQuery = ({
	event,
	sub,
	since,
	until,
}: Omit<z.infer<typeof search>, "q">) =>
	infiniteQueryOptions({
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

function Audit() {
	const filters = Route.useSearch();
	const { event, sub, since, until } = filters;
	const navigate = useNavigate({ from: Route.fullPath });
	const can = useCan();
	const [choices, setChoices] = useState<User[]>();
	const [finding, setFinding] = useState(false);
	const events = useSuspenseInfiniteQuery(eventsQuery(filters));
	const rows = events.data.pages.flatMap((p) => p.events);
	const set = (k: keyof z.infer<typeof search>, v: string) =>
		navigate({ search: (s) => ({ ...s, [k]: v || undefined }) });
	const filterBy = (q: string, sub: string) => {
		setChoices(undefined);
		navigate({
			search: (s) => ({ ...s, q: q || undefined, sub: sub || undefined }),
		});
	};
	// find looks the typed text up as a User; without users:read it can only
	// be an ID.
	const find = async (q: string) => {
		if (!q) {
			return filterBy("", "");
		}
		setFinding(true);
		try {
			const users = can("users:read")
				? (
						await api<{ users: User[] }>(
							`/users?${new URLSearchParams({ q, limit: "20" })}`,
						)
					).users
				: [];
			const found = findUser(q, users);
			if ("sub" in found) {
				filterBy(q, found.sub);
			} else {
				setChoices(found.choices);
			}
		} finally {
			setFinding(false);
		}
	};
	const filtered = !!(event || sub || since || until);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap gap-2">
				<Select value={event} onValueChange={(v) => set("event", `${v ?? ""}`)}>
					<SelectTrigger className="w-56">
						<SelectValue>
							{(v: string) => (v ? eventName(v) : "全部事件")}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">全部事件</SelectItem>
						{eventGroups.map(([group, list]) => (
							<SelectGroup key={group}>
								<SelectLabel>{group}</SelectLabel>
								{list.map(([k, name]) => (
									<SelectItem key={k} value={k}>
										{name}
									</SelectItem>
								))}
							</SelectGroup>
						))}
					</SelectContent>
				</Select>
				<form
					className="flex-1"
					onSubmit={(e) => {
						e.preventDefault();
						find(`${new FormData(e.currentTarget).get("q") ?? ""}`.trim());
					}}
				>
					<Input
						key={filters.q}
						name="q"
						defaultValue={filters.q}
						disabled={finding}
						placeholder={
							can("users:read") ? "手机号、邮箱、用户名或用户 ID" : "用户 ID"
						}
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
			{choices && (
				<div className="space-y-2 rounded-xl bg-primary-soft px-4 py-3 text-sm">
					<p>找到 {choices.length} 个用户，选一个查看记录：</p>
					<ul className="flex flex-wrap gap-2">
						{choices.map((u) => (
							<li key={u.sub}>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										filterBy(primaryIdentifier(u.identifiers) ?? u.sub, u.sub)
									}
								>
									{primaryIdentifier(u.identifiers) ?? (
										<span className="font-mono">{u.sub.slice(0, 8)}</span>
									)}
								</Button>
							</li>
						))}
					</ul>
				</div>
			)}
			<EventTable
				events={rows}
				empty={
					filtered && (
						<>
							<span>没有符合条件的事件</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									setChoices(undefined);
									navigate({ search: {} });
								}}
							>
								清除筛选
							</Button>
						</>
					)
				}
			/>
			{events.isFetchNextPageError && (
				<p className="text-destructive text-sm">{events.error?.message}</p>
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
		</div>
	);
}

function Sentence({ parts }: { parts: Part[] }) {
	return parts.map((p, i) => {
		const key = `${i}`;
		if (typeof p === "string") {
			return p;
		}
		const className = p.mono ? "font-mono text-xs" : undefined;
		if (p.user) {
			return (
				<Link
					key={key}
					to="/console/users/$sub"
					params={{ sub: p.user }}
					className="underline-offset-2 hover:underline"
				>
					{p.text}
				</Link>
			);
		}
		if (p.app) {
			return (
				<Link
					key={key}
					to="/console/apps/$clientId"
					params={{ clientId: p.app }}
					className="underline-offset-2 hover:underline"
				>
					{p.text}
				</Link>
			);
		}
		return (
			<span key={key} className={className}>
				{p.text}
			</span>
		);
	});
}

// EventTable is the audit log as 时间 / 操作人 / 事件描述, shared by the
// audit page and the overview. empty is what a row says when there are
// no events.
export function EventTable({
	events,
	empty,
}: {
	events: AuditEvent[];
	empty?: ReactNode;
}) {
	const { names, naming } = useNames();
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>时间</TableHead>
					<TableHead>操作人</TableHead>
					<TableHead>事件描述</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{(naming ? [] : events).map((ev) => {
					const { parts, title } = describe(ev, names);
					return (
						<TableRow key={ev.id}>
							<TableCell className="whitespace-nowrap text-faint text-xs">
								{date(ev.at)}
							</TableCell>
							<TableCell className="whitespace-nowrap">
								<Sentence parts={actor(ev)} />
							</TableCell>
							<TableCell className="whitespace-normal" title={title}>
								<Sentence parts={parts} />
							</TableCell>
						</TableRow>
					);
				})}
				{empty && !naming && events.length === 0 && (
					<TableRow>
						<TableCell
							colSpan={3}
							className="space-x-2 text-center text-muted-foreground"
						>
							{empty}
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

// useNames fetches the Application and API resource names events refer
// to; naming is true until they're in.
function useNames() {
	const can = useCan();
	const readApps = can("applications:read");
	const apps = useQuery({ ...applicationsQuery, enabled: readApps });
	const apis = useQuery({ ...apisQuery, enabled: readApps });
	return {
		names: {
			apps: readApps ? apps.data?.applications : undefined,
			apis: apis.data?.apis,
		},
		// Wait for the names, or every ID would show raw as if deleted.
		naming: readApps && (apps.isPending || apis.isPending),
	};
}

// EventList is the overview's recent events: one line each, who did it
// and what, then when.
export function EventList({ events }: { events: AuditEvent[] }) {
	const { names, naming } = useNames();
	return (
		<ItemList>
			{(naming ? [] : events).map((ev) => {
				const { parts, title } = describe(ev, names);
				const who = actor(ev);
				const [first] = who;
				return (
					<Item key={ev.id}>
						<ItemMedia>
							{!doneBy(ev) ? (
								<Avatar size="sm">
									<AvatarFallback className="bg-canvas text-faint">
										<Star className="size-3" />
									</AvatarFallback>
								</Avatar>
							) : (
								<UserAvatar
									name={typeof first === "string" ? undefined : first.text}
								/>
							)}
						</ItemMedia>
						<ItemContent className="min-w-0" title={title}>
							<p>
								<span className="font-medium">
									<Sentence parts={who} />
								</span>{" "}
								<Sentence parts={parts} />
							</p>
						</ItemContent>
						<span className="shrink-0 text-faint text-xs">{date(ev.at)}</span>
					</Item>
				);
			})}
		</ItemList>
	);
}
