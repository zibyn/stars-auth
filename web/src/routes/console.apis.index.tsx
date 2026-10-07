import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { EmptyState } from "#/components/console";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { onlyBuiltin } from "#/lib/apps";
import { type APIDef, api, apiPath } from "#/lib/console-api";
import { useCan } from "./console";

export const Route = createFileRoute("/console/apis/")({ component: APIs });

export const apisQuery = {
	queryKey: ["apis"],
	queryFn: () => api<{ apis: APIDef[] }>("/apis"),
};

function APIs() {
	const can = useCan();
	const apis = useQuery(apisQuery);
	const writable = can("applications:write");
	return (
		<Card>
			<CardHeader>
				<CardTitle>API 资源</CardTitle>
				<p className="text-muted-foreground text-sm">
					在这里登记你的后端服务，再为它定义权限和角色。用户登录某个应用后，拿到的令牌只带这个应用默认
					API 资源上的角色和权限。
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				{apis.data && onlyBuiltin(apis.data.apis) && (
					<EmptyState
						title="还没有你自己的 API 资源"
						action={
							writable ? (
								<Button
									onClick={() =>
										document
											.querySelector<HTMLInputElement>("#new-api input")
											?.focus()
									}
								>
									添加 API 资源
								</Button>
							) : (
								<span className="text-muted-foreground">
									需要「管理员」角色才能创建。
								</span>
							)
						}
					>
						如果你的后端要校验用户能做什么，在这里登记它，再定义权限和角色。只用登录、不需要权限控制的话，可以不建。
					</EmptyState>
				)}
				<div className="overflow-hidden rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>名称</TableHead>
								<TableHead>API 资源标识符</TableHead>
								<TableHead>权限</TableHead>
								<TableHead>角色</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{apis.data?.apis.map((a) => (
								<TableRow key={a.identifier}>
									<TableCell>
										<Link
											to="/console/apis/$api"
											params={{ api: a.identifier }}
											className="hover:underline"
										>
											{a.name}
										</Link>{" "}
										{a.builtin && <Badge variant="secondary">内置</Badge>}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{a.identifier}
									</TableCell>
									<TableCell>{a.permissions.length}</TableCell>
									<TableCell>{a.roles.length}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				{apis.error && (
					<p className="text-destructive text-sm">{apis.error.message}</p>
				)}
				{writable && <CreateForm />}
			</CardContent>
		</Card>
	);
}

function CreateForm() {
	const client = useQueryClient();
	const navigate = useNavigate();
	const create = useMutation({
		mutationFn: (v: { identifier: string; name: string }) =>
			api(apiPath(v.identifier), { method: "PUT", body: { name: v.name } }),
		onSuccess: async (_, v) => {
			await client.invalidateQueries(apisQuery);
			navigate({ to: "/console/apis/$api", params: { api: v.identifier } });
		},
	});
	return (
		<form
			id="new-api"
			className="space-y-3 rounded-lg border p-4"
			onSubmit={(e) => {
				e.preventDefault();
				const f = new FormData(e.currentTarget);
				create.mutate({
					identifier: `${f.get("identifier")}`,
					name: `${f.get("name")}`,
				});
			}}
		>
			<h3 className="font-medium text-sm">添加 API 资源</h3>
			<div className="flex flex-wrap gap-2">
				<Input
					name="identifier"
					required
					aria-label="API 资源标识符"
					placeholder="https://api.example.com"
					className="w-72 font-mono"
				/>
				<Input
					name="name"
					required
					aria-label="名称"
					placeholder="如：订单 API"
					className="w-40"
				/>
				<Button type="submit" variant="outline" disabled={create.isPending}>
					添加 API 资源
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				API 资源标识符是你的后端校验令牌时认的名字，即 access token 的
				aud。登记后不能更改。
			</p>
			{create.error && (
				<p className="text-destructive text-sm">{create.error.message}</p>
			)}
		</form>
	);
}
