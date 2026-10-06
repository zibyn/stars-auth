import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { finishLogin } from "#/lib/console-api";

// Outside the console layout, which would start another login.
export const Route = createFileRoute("/console_/callback")({
	component: Callback,
});

function Callback() {
	const navigate = useNavigate();
	const [error, setError] = useState("");
	useEffect(() => {
		finishLogin(new URLSearchParams(location.search)).then(
			(to) => navigate({ href: to, replace: true }),
			(e: Error) => setError(e.message),
		);
	}, [navigate]);
	return (
		<main className="flex min-h-svh flex-col items-center justify-center gap-4">
			{error ? (
				<>
					<p>{error}</p>
					<Link to="/console" className="underline underline-offset-4">
						重新登录
					</Link>
				</>
			) : (
				<p className="text-muted-foreground">正在登录…</p>
			)}
		</main>
	);
}
