import { createFileRoute, Link } from "@tanstack/react-router";

// Unknown URLs. A catch-all route rather than a root notFoundComponent, so the
// page ships in its own chunk instead of the main bundle.
export const Route = createFileRoute("/$")({ component: NotFound });

function NotFound() {
	return (
		<main className="flex min-h-svh flex-col items-center justify-center gap-4">
			<h1 className="text-2xl font-medium">页面不存在</h1>
			<Link to="/account" className="underline underline-offset-4">
				返回账号中心
			</Link>
		</main>
	);
}
