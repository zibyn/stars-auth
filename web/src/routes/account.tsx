import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/account")({ component: Account });

// Placeholder until the account center lands (#37).
function Account() {
	return (
		<main className="flex min-h-svh items-center justify-center">
			<h1 className="text-2xl font-medium">账号中心</h1>
		</main>
	);
}
