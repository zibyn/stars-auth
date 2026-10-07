import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState } from "#/components/console";
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
import { useCan } from "./console";
import { apisQuery } from "./console.apis.index";

export const Route = createFileRoute("/console/apps/")({
	component: Applications,
});

export const applicationsQuery = {
	queryKey: ["applications"],
	queryFn: () => api<{ applications: Application[] }>("/applications"),
};

function Applications() {
	const can = useCan();
	const apps = useQuery(applicationsQuery);
	const apis = useQuery(apisQuery);
	const apiName = (identifier?: string) =>
		apis.data?.apis.find((a) => a.identifier === identifier)?.name ??
		identifier;
	const create = can("applications:write") && (
		<Link to="/console/apps/new" className={buttonVariants()}>
			创建应用
		</Link>
	);
	// When empty, the empty state carries the one create button.
	const empty = apps.data && onlyBuiltin(apps.data.applications);
	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="font-semibold text-2xl tracking-tight">应用</h1>
				{!empty && create}
			</div>
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
