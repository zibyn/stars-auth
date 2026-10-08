import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { onlyBuiltin, typeName } from "#/lib/apps";
import { type Application, api } from "#/lib/console-api";
import { apisQuery } from "#/routes/console/apis/index";
import { type Header, useCan } from "#/routes/console/route";

export const Route = createFileRoute("/console/apps/")({
	staticData: { useHeader },
	loader: ({ context: { queryClient } }) =>
		Promise.all([
			queryClient.ensureQueryData(applicationsQuery),
			queryClient.ensureQueryData(apisQuery),
		]),
	component: Applications,
});

export const applicationsQuery = {
	queryKey: ["applications"],
	queryFn: () => api<{ applications: Application[] }>("/applications"),
};

// useCreate is the one create button, or false without the Permission.
// When there are no apps of your own, the empty state carries it instead
// of the header.
function useCreate(applications?: Application[]) {
	const can = useCan();
	const create = can("applications:write") && (
		<Link to="/console/apps/new" className={buttonVariants()}>
			创建应用
		</Link>
	);
	const empty = !!applications && onlyBuiltin(applications);
	return { create, empty };
}

function useHeader(): Header | null {
	// The header draws in the layout, around the page's loading and
	// errors, so it reads without suspending.
	const apps = useQuery(applicationsQuery).data;
	const { create, empty } = useCreate(apps?.applications);
	return { title: "应用", actions: !empty && create };
}

function Applications() {
	const { applications } = useSuspenseQuery(applicationsQuery).data;
	const { apis } = useSuspenseQuery(apisQuery).data;
	const apiName = (identifier?: string) =>
		apis.find((a) => a.identifier === identifier)?.name ?? identifier;
	const { create, empty } = useCreate(applications);
	return (
		<div className="space-y-6">
			{empty && (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>还没有接入你的应用</EmptyTitle>
						<EmptyDescription>
							你的 App、网站或小程序要先在这里创建，才能让用户用认证服务登录。
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						{create || (
							<span className="text-muted-foreground">
								需要「管理员」角色才能创建。
							</span>
						)}
					</EmptyContent>
				</Empty>
			)}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>名称</TableHead>
						<TableHead>client_id</TableHead>
						<TableHead>类型</TableHead>
						<TableHead>默认 API 资源</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{applications.map((a) => (
						<TableRow key={a.clientId}>
							<TableCell>
								<Link
									to="/console/apps/$clientId"
									params={{ clientId: a.clientId }}
									className="font-medium hover:underline"
								>
									{a.name}
								</Link>{" "}
								{a.builtin && <Badge variant="secondary">内置</Badge>}
							</TableCell>
							<TableCell className="font-mono text-muted-foreground text-xs">
								{a.clientId}
							</TableCell>
							<TableCell>{typeName[a.type]}</TableCell>
							<TableCell>{apiName(a.defaultApi) || "—"}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
