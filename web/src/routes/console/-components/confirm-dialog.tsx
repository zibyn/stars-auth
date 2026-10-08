// Page layout only. If shadcn has the component, use components/ui (ADR 0009).

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { type ReactElement, type ReactNode, useRef } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";

// ConfirmDialog asks before an action, in place of the native confirm():
// title is a question naming the object, children spell out the
// consequence, action is verb + object (「删除应用」), never 「确定」.
// Pass trigger to open it from a button, or open/onOpenChange to drive it.
// Without action it only explains, for an action that can't go ahead yet.
// It opens with focus on 取消 and doesn't close on a click outside.
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
	const cancel = useRef<HTMLButtonElement>(null);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			{trigger && (
				<AlertDialogTrigger render={trigger}>
					{trigger.props.children}
				</AlertDialogTrigger>
			)}
			<AlertDialogContent initialFocus={cancel}>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription render={<div />}>
						{children}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel ref={cancel}>
						{action ? "取消" : "知道了"}
					</AlertDialogCancel>
					{/* shadcn's AlertDialogAction doesn't close; Close does. */}
					{action && (
						<AlertDialogPrimitive.Close
							render={
								<AlertDialogAction
									variant={destructive ? "destructive" : "default"}
									onClick={onConfirm}
								/>
							}
						>
							{action}
						</AlertDialogPrimitive.Close>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
