import { createFileRoute } from "@tanstack/react-router";

// The apis group names itself in the breadcrumb; with no component it
// renders the matched page.
export const Route = createFileRoute("/console/apis")({
	staticData: { crumb: "API 资源" },
});
