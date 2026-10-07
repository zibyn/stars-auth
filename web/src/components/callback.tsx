import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

// Callback finishes a sign-in at home + "/callback"; it lives outside home's
// layout, which would start another login.
export function Callback({
	finishLogin,
	home,
}: {
	finishLogin: (params: URLSearchParams) => Promise<string>;
	home: string;
}) {
	const navigate = useNavigate();
	const [error, setError] = useState("");
	useEffect(() => {
		finishLogin(new URLSearchParams(location.search)).then(
			(to) => navigate({ href: to, replace: true }),
			(e: Error) => setError(e.message),
		);
	}, [navigate, finishLogin]);
	return (
		<main className="flex min-h-svh flex-col items-center justify-center gap-4">
			{error ? (
				<>
					<p>{error}</p>
					<Link to={home} className="underline underline-offset-4">
						重新登录
					</Link>
				</>
			) : (
				<p className="text-muted-foreground">正在登录…</p>
			)}
		</main>
	);
}
