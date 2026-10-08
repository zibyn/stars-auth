import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { ChannelsTab } from "./-settings/channels";
import { LoginTab } from "./-settings/login";
import { SecurityTab } from "./-settings/security";

const search = z.object({
	tab: z.enum(["login", "channels", "security"]).optional().catch(undefined),
});

export const Route = createFileRoute("/console/settings")({
	validateSearch: search,
	component: Settings,
});

function Settings() {
	const { tab = "login" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	return (
		<>
			<h1 className="font-semibold text-2xl tracking-tight">设置</h1>
			<Tabs
				value={tab}
				onValueChange={(v) =>
					navigate({ search: { tab: v === "login" ? undefined : v } })
				}
				className="gap-6"
			>
				<TabsList variant="line">
					<TabsTrigger value="login">登录方式</TabsTrigger>
					<TabsTrigger value="channels">通道</TabsTrigger>
					<TabsTrigger value="security">安全</TabsTrigger>
				</TabsList>
				<TabsContent value="login">
					<LoginTab />
				</TabsContent>
				<TabsContent value="channels">
					<ChannelsTab />
				</TabsContent>
				<TabsContent value="security">
					<SecurityTab />
				</TabsContent>
			</Tabs>
		</>
	);
}
