// Page layout only. If shadcn has the component, use components/ui (ADR 0009).

import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

// Panel is the raised card a page's content sits on.
export function Panel({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<main
			className={cn(
				"rounded-2xl bg-card shadow-xs ring-1 ring-border",
				className,
			)}
		>
			{children}
		</main>
	);
}
