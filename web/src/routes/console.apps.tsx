import { createFileRoute } from "@tanstack/react-router";

// The apps group names itself in the breadcrumb; with no component it
// renders the matched page.
export const Route = createFileRoute("/console/apps")({
	staticData: { crumb: "应用" },
});
