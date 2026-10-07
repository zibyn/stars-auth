import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/dialog";

// ConfirmDialog asks before an action, in place of the native confirm():
// title is a question naming the object, children spell out the
// consequence, action is verb + object (「删除应用」), never 「确定」.
// Pass trigger to open it from a button, or open/onOpenChange to drive it.
export function ConfirmDialog({
	trigger,
	open,
	onOpenChange,
	title,
	children,
	action,
	onConfirm,
	destructive = true,
}: {
	trigger?: ReactElement<{ children?: ReactNode }>;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	title: string;
	children: ReactNode;
	action: string;
	onConfirm: () => void;
	destructive?: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger && (
				<DialogPrimitive.Trigger render={trigger}>
					{trigger.props.children}
				</DialogPrimitive.Trigger>
			)}
			<DialogContent>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription render={<div />}>{children}</DialogDescription>
				<div className="flex justify-end gap-2">
					<DialogPrimitive.Close render={<Button variant="outline" />}>
						取消
					</DialogPrimitive.Close>
					<DialogPrimitive.Close
						render={
							<Button
								variant={destructive ? "destructive" : "default"}
								onClick={onConfirm}
							/>
						}
					>
						{action}
					</DialogPrimitive.Close>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// InlineWarning is one sentence, optionally with a link to fix it.
export function InlineWarning({
	children,
	link,
}: {
	children: ReactNode;
	link?: { label: string } & Pick<LinkProps, "to" | "search">;
}) {
	return (
		<p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 text-sm dark:text-amber-200">
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

// DangerZone is the red-bordered block at the foot of a page: what
// deleting does first, then the button.
export function DangerZone({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="space-y-3 rounded-lg border border-destructive/50 p-4">
			<h3 className="font-medium text-destructive">{title}</h3>
			{children}
		</section>
	);
}
