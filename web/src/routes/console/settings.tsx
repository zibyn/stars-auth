import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TabsContent } from "#/components/ui/tabs";
import { ChannelsTab } from "./-settings/channels";
import { LoginTab } from "./-settings/login";
import { SecurityTab } from "./-settings/security";

const search = z.object({
	tab: z.enum(["login", "channels", "security"]).optional().catch(undefined),
});

export const Route = createFileRoute("/console/settings")({
	staticData: {
		useHeader: () => ({
			title: "设置",
			tabs: [
				["login", "登录方式"],
				["channels", "通道"],
				["security", "安全"],
			],
		}),
	},
	validateSearch: search,
	component: Settings,
});

function Settings() {
	return (
		<>
			<TabsContent value="login">
				<LoginTab />
			</TabsContent>
			<TabsContent value="channels">
				<ChannelsTab />
			</TabsContent>
			<TabsContent value="security">
				<SecurityTab />
			</TabsContent>
		</>
	);
}
