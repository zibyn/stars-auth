// Page layout only. If shadcn has the component, use components/ui (ADR 0009).

import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

// EmptyState says what belongs here and why, then offers one way in:
// action is the primary button, or the "需要「…」角色" note when the
// reader can't act.
export function EmptyState({
	title,
	children,
	action,
}: {
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="space-y-2 rounded-xl border border-dashed p-6">
			<h3 className="font-medium text-sm">{title}</h3>
			<p className="text-[13px] text-muted-foreground">{children}</p>
			{action && (
				<div className="flex items-center gap-3 text-sm">{action}</div>
			)}
		</div>
	);
}

// InlineWarning is one sentence, optionally with a link to fix it: an
// accent block, tinted and borderless.
export function InlineWarning({
	children,
	link,
}: {
	children: ReactNode;
	link?: { label: string } & Pick<LinkProps, "to" | "search">;
}) {
	return (
		<p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-900 text-sm dark:text-amber-200">
			{children}
			{link && (
				<>
					{" "}
					<Link to={link.to} search={link.search} className="underline">
						{link.label}
					</Link>
				</>
			)}
		</p>
	);
}
