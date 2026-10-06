import { createFileRoute, redirect } from "@tanstack/react-router";

// 概览 is not built yet; land on 身份.
export const Route = createFileRoute("/console/")({
	beforeLoad: () => {
		throw redirect({ to: "/console/users" });
	},
});
