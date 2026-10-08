import { queryOptions } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FullPage, RouteError, RoutePending } from "#/components/route-states";
import { api, type Me } from "#/lib/account-api";

export const meQuery = queryOptions({
	queryKey: ["account", "me"],
	queryFn: () => api<Me>("/me"),
	retry: false,
});

// The account center's pages render once the signed-in User is known;
// without a token api leaves for the login page and never returns.
export const Route = createFileRoute("/account")({
	beforeLoad: async ({ context }) => ({
		me: await context.queryClient.ensureQueryData(meQuery),
	}),
	pendingComponent: () => (
		<FullPage>
			<RoutePending />
		</FullPage>
	),
	errorComponent: (props) => (
		<FullPage>
			<RouteError {...props} />
		</FullPage>
	),
});
