import { createFileRoute } from "@tanstack/react-router";
import { Callback } from "#/components/callback";
import { finishLogin } from "#/lib/account-api";

export const Route = createFileRoute("/account_/callback")({
	component: () => <Callback finishLogin={finishLogin} home="/account" />,
});
