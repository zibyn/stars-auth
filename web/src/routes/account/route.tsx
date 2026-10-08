import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { api, type Me } from "#/lib/account-api";

export const Route = createFileRoute("/account")({ component: Account });

export const meQuery = queryOptions({
	queryKey: ["account", "me"],
	queryFn: () => api<Me>("/me"),
	retry: false,
});

// Account renders its pages once the signed-in User is known.
function Account() {
	const me = useQuery(meQuery);
	if (me.error) {
		return (
			<main className="flex min-h-svh items-center justify-center bg-canvas">
				<p>账号中心加载失败:{me.error.message}</p>
			</main>
		);
	}
	if (!me.data) {
		return null;
	}
	return <Outlet />;
}
