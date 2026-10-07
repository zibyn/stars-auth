import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
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
		<div className="space-y-2 rounded-lg border border-dashed p-4">
			<h4 className="font-medium text-sm">{title}</h4>
			<p className="text-muted-foreground text-sm">{children}</p>
			{action && (
				<div className="flex items-center gap-3 text-sm">{action}</div>
			)}
		</div>
	);
}

// Section is one form: children are what an editor may change, extra
// stays usable for readers (copying client_id).
export function Section({
	title,
	intro,
	editable,
	onSubmit,
	extra,
	footer,
	children,
}: {
	title: string;
	intro?: string;
	editable: boolean;
	onSubmit: (f: FormData, form: HTMLFormElement) => void;
	extra?: ReactNode;
	footer: ReactNode;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{intro && <p className="text-muted-foreground text-sm">{intro}</p>}
			</CardHeader>
			<CardContent>
				<form
					className="space-y-5"
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit(new FormData(e.currentTarget), e.currentTarget);
					}}
				>
					<fieldset disabled={!editable} className="space-y-5">
						{children}
					</fieldset>
					{extra}
					{footer}
				</form>
			</CardContent>
		</Card>
	);
}

// SaveBar is a section's save button and how the last save went.
export function SaveBar({
	save,
}: {
	save: { isPending: boolean; isSuccess: boolean; error: Error | null };
}) {
	return (
		<div className="flex items-center gap-3">
			<Button type="submit" disabled={save.isPending}>
				保存
			</Button>
			{save.isSuccess && <span className="text-green-700 text-sm">已保存</span>}
			{save.error && (
				<span className="text-destructive text-sm">{save.error.message}</span>
			)}
		</div>
	);
}

export function Field({
	label,
	en,
	help,
	children,
}: {
	label: string;
	en?: string; // the original term, in small print beside the label
	help?: string;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-1.5">
			<span className="font-medium text-sm">
				{label}
				{en && (
					<span className="ml-1 font-normal text-muted-foreground text-xs">
						{en}
					</span>
				)}
			</span>
			{children}
			{help && <p className="text-muted-foreground text-xs">{help}</p>}
		</div>
	);
}
