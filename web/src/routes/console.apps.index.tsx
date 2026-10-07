import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { EmptyState } from "#/components/console";
import { Badge } from "#/components/ui/badge";
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
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { onlyBuiltin, typeName, typeWhy } from "#/lib/apps";
import { type Application, api } from "#/lib/console-api";
import { useCan } from "./console";
import { apisQuery } from "./console.apis";

const search = z.object({
	new: z.boolean().optional(), // the create sheet is open
});

export const Route = createFileRoute("/console/apps/")({
	validateSearch: search,
	component: Applications,
});

export const applicationsQuery = {
	queryKey: ["applications"],
	queryFn: () => api<{ applications: Application[] }>("/applications"),
};

function Applications() {
	const { new: creating } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const can = useCan();
	const apps = useQuery(applicationsQuery);
	const apis = useQuery(apisQuery);
	const apiName = (identifier?: string) =>
		apis.data?.apis.find((a) => a.identifier === identifier)?.name ??
		identifier;
	const setCreating = (open: boolean) =>
		navigate({ search: { new: open || undefined } });
	const create = can("applications:write") && (
		<Button onClick={() => setCreating(true)}>创建应用</Button>
	);
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>应用</CardTitle>
				{create}
			</CardHeader>
			<CardContent className="space-y-4">
				{apps.data && onlyBuiltin(apps.data.applications) && (
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
				<div className="overflow-hidden rounded-lg border">
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
											className="hover:underline"
										>
											{a.name}
										</Link>{" "}
										{a.builtin && <Badge variant="secondary">内置</Badge>}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{a.clientId}
									</TableCell>
									<TableCell>{typeName[a.type]}</TableCell>
									<TableCell>{apiName(a.defaultApi) || "—"}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				{apps.error && (
					<p className="text-destructive text-sm">{apps.error.message}</p>
				)}
			</CardContent>
			<Sheet open={!!creating} onOpenChange={setCreating}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
					<SheetHeader>
						<SheetTitle>创建应用</SheetTitle>
					</SheetHeader>
					{creating && <CreateForm />}
				</SheetContent>
			</Sheet>
		</Card>
	);
}

// CreateForm asks only what can't change later; the rest is set on the
// Application's page. ponytail: stopgap until the create page (#59).
function CreateForm() {
	const client = useQueryClient();
	const navigate = useNavigate();
	const [type, setType] = useState<Application["type"]>("public");
	// A client secret shows once, before leaving for the new Application.
	const [created, setCreated] = useState<{
		clientId: string;
		secret: string;
	}>();
	const save = useMutation({
		mutationFn: (name: string) =>
			api<{ application: Application; secret?: string }>("/applications", {
				method: "POST",
				body: {
					type,
					settings: {
						name,
						redirectUris: [],
						postLogoutRedirectUris: [],
						refreshTokens: true,
						appleAppIds: [],
						androidApps: [],
					},
				},
			}),
		onSuccess: async ({ application, secret }) => {
			await client.invalidateQueries(applicationsQuery);
			const open = { clientId: application.clientId };
			if (secret) {
				setCreated({ ...open, secret });
			} else {
				navigate({ to: "/console/apps/$clientId", params: open });
			}
		},
	});
	if (created) {
		return (
			<div className="space-y-4 px-4 pb-4">
				<p className="rounded-lg border border-amber-500 p-3 text-sm">
					client secret 只显示这一次，请立即保存到服务器配置里：
					<span className="block break-all font-mono">{created.secret}</span>
				</p>
				<Button
					onClick={() =>
						navigate({
							to: "/console/apps/$clientId",
							params: { clientId: created.clientId },
						})
					}
				>
					我已保存，去应用详情
				</Button>
			</div>
		);
	}
	return (
		<form
			className="space-y-4 px-4 pb-4"
			onSubmit={(e) => {
				e.preventDefault();
				save.mutate(`${new FormData(e.currentTarget).get("name")}`);
			}}
		>
			<div className="grid gap-1.5">
				<span className="font-medium text-sm">类型</span>
				<Select
					value={type}
					onValueChange={(v) => setType(v as Application["type"])}
				>
					<SelectTrigger>
						<SelectValue>{(v: Application["type"]) => typeName[v]}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="public">{typeName.public}</SelectItem>
						<SelectItem value="confidential">
							{typeName.confidential}
						</SelectItem>
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-xs">{typeWhy[type]}</p>
			</div>
			<div className="grid gap-1.5">
				<label htmlFor="name" className="font-medium text-sm">
					名称
				</label>
				<Input id="name" name="name" required placeholder="如：星选商城 App" />
			</div>
			{save.error && (
				<p className="text-destructive text-sm">{save.error.message}</p>
			)}
			<Button type="submit" disabled={save.isPending}>
				创建应用
			</Button>
		</form>
	);
}
