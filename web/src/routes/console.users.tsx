import { createFileRoute } from "@tanstack/react-router";

// The users group names itself in the breadcrumb; with no component it
// renders the matched page.
export const Route = createFileRoute("/console/users")({
	staticData: { crumb: "用户" },
});
