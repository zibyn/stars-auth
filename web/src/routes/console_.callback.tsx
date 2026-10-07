import { createFileRoute } from "@tanstack/react-router";
import { Callback } from "#/components/callback";
import { finishLogin } from "#/lib/console-api";

export const Route = createFileRoute("/console_/callback")({
	component: () => <Callback finishLogin={finishLogin} home="/console" />,
});
