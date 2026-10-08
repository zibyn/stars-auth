import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
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
import { EmptyState } from "#/routes/console/-components/notice";
import { apisQuery } from "#/routes/console/apis/index";
import { type Header, useCan } from "#/routes/console/route";

export const Route = createFileRoute("/console/apps/")({
	staticData: { useHeader },
	component: Applications,
});

export const applicationsQuery = {
	queryKey: ["applications"],
	queryFn: () => api<{ applications: Application[] }>("/applications"),
};

// useCreate is the one create button, or false without the Permission.
// When there are no apps of your own, the empty state carries it instead
// of the header.
function useCreate() {
	const can = useCan();
	const apps = useQuery(applicationsQuery);
	const create = can("applications:write") && (
		<Link to="/console/apps/new" className={buttonVariants()}>
			创建应用
		</Link>
	);
	const empty = apps.data && onlyBuiltin(apps.data.applications);
	return { create, empty };
}

function useHeader(): Header | null {
	const { create, empty } = useCreate();
	return { title: "应用", actions: !empty && create };
}

function Applications() {
	const apps = useQuery(applicationsQuery);
	const apis = useQuery(apisQuery);
	const apiName = (identifier?: string) =>
		apis.data?.apis.find((a) => a.identifier === identifier)?.name ??
		identifier;
	const { create, empty } = useCreate();
	return (
		<div className="space-y-6">
			{empty && (
				<EmptyState
					title="还没有接入你的应用"
					action={
						create || (
							<span className="text-muted-foreground">
								需要「管理员」角色才能创建。
							</span>
						)
					}
				>
					你的 App、网站或小程序要先在这里创建，才能让用户用认证服务登录。
				</EmptyState>
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
					{apps.data?.applications.map((a) => (
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
			{apps.error && (
				<p className="text-destructive text-sm">{apps.error.message}</p>
			)}
		</div>
	);
}
