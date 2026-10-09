import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { TabsContent } from "#/components/ui/tabs";
import { ChannelsTab, channelsQuery } from "./-settings/channels";
import { LoginTab } from "./-settings/login";
import { policyQuery } from "./-settings/policy";
import { SecurityTab, signingKeysQuery } from "./-settings/security";

const defaults = { tab: "login" } as const;
const search = z.object({
	tab: z
		.enum(["login", "channels", "security"])
		.default(defaults.tab)
		.catch(defaults.tab),
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
	search: { middlewares: [stripSearchParams(defaults)] },
	loader: ({ context: { queryClient } }) =>
		Promise.all([
			queryClient.ensureQueryData(policyQuery),
			queryClient.ensureQueryData(channelsQuery),
			queryClient.ensureQueryData(signingKeysQuery),
		]),
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
