// Page layout only. If shadcn has the component, use components/ui (ADR 0009).

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
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
// Without action it only explains, for an action that can't go ahead yet.
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
	destructive?: boolean;
} & (
	| { action: string; onConfirm: () => void }
	| { action?: never; onConfirm?: never }
)) {
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
						{action ? "取消" : "知道了"}
					</DialogPrimitive.Close>
					{action && (
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
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
