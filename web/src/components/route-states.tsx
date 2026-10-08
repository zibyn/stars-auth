import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";

// RoutePending stands in for a page while its data loads.
export function RoutePending() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-6 w-1/3" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-2/3" />
		</div>
	);
}

// RouteError says a page's data failed to load; 重试 loads it again.
export function RouteError({ error }: ErrorComponentProps) {
	const router = useRouter();
	const queryReset = useQueryErrorResetBoundary();
	useEffect(() => queryReset.reset(), [queryReset]);
	return (
		<Alert variant="destructive">
			<AlertTitle>加载失败</AlertTitle>
			<AlertDescription>
				{error instanceof Error ? error.message : String(error)}
			</AlertDescription>
			<AlertAction>
				<Button size="sm" variant="outline" onClick={() => router.invalidate()}>
					重试
				</Button>
			</AlertAction>
		</Alert>
	);
}

// FullPage centers a layout route's pending or error state on the canvas.
export function FullPage({ children }: { children: ReactNode }) {
	return (
		<main className="flex min-h-svh items-center justify-center bg-canvas p-6">
			<div className="w-full max-w-md">{children}</div>
		</main>
	);
}
