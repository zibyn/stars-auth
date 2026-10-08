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
import { cn } from "#/lib/utils";

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
		<section className="space-y-3 rounded-xl border border-destructive/50 p-6">
			<h2 className="font-semibold text-[15px] text-destructive">{title}</h2>
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
		<div className="space-y-2 rounded-xl border border-dashed p-6">
			<h3 className="font-medium text-sm">{title}</h3>
			<p className="text-[13px] text-muted-foreground">{children}</p>
			{action && (
				<div className="flex items-center gap-3 text-sm">{action}</div>
			)}
		</div>
	);
}

// SectionHeading is a section's title and the line under it. Content
// follows mt-4 below it.
export function SectionHeading({
	title,
	intro,
}: {
	title: string;
	intro?: ReactNode;
}) {
	return (
		<>
			<h2 className="font-semibold text-[15px]">{title}</h2>
			{intro && (
				<p className="mt-1 text-[13px] text-muted-foreground">{intro}</p>
			)}
		</>
	);
}

// Section is a section title and its content, no card around it. With
// onSubmit the content is a form: children are what an editor may change,
// extra stays usable for readers (copying client_id). Without it the rows
// act on their own. Put sections in a space-y-10 parent for the 40px between.
export function Section({
	title,
	intro,
	editable = true,
	onSubmit,
	extra,
	footer,
	children,
}: {
	title: string;
	intro?: ReactNode;
	editable?: boolean;
	onSubmit?: (f: FormData, form: HTMLFormElement) => void;
	extra?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section>
			<SectionHeading title={title} intro={intro} />
			{onSubmit ? (
				<form
					className="mt-4 space-y-6"
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit(new FormData(e.currentTarget), e.currentTarget);
					}}
				>
					<fieldset disabled={!editable} className="space-y-6">
						{children}
					</fieldset>
					{extra}
					{footer}
				</form>
			) : (
				<div className="mt-4">{children}</div>
			)}
		</section>
	);
}

// PageHeader opens every console page, below the breadcrumb the console
// layout draws: the title with its badges, actions on the right, an
// optional line on what the page is for, then children (notes, the
// 接入清单) and the TabsList last. Pages with tabs put it inside <Tabs>.
export function PageHeader({
	title,
	badges,
	actions,
	description,
	tabs,
	children,
}: {
	title: ReactNode;
	badges?: ReactNode;
	actions?: ReactNode;
	description?: ReactNode;
	tabs?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="space-y-4">
			<div>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="flex items-center gap-3 font-semibold text-2xl tracking-tight">
						{title}
					</h1>
					{badges}
					{actions && (
						<div className="ml-auto flex items-center gap-2">{actions}</div>
					)}
				</div>
				{description && (
					<p className="mt-1 text-muted-foreground">{description}</p>
				)}
			</div>
			{children}
			{tabs}
		</header>
	);
}

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
		<div className="grid gap-2">
			<span className="font-medium text-[13px]">
				{label}
				{en && (
					<span className="ml-1 font-normal text-muted-foreground text-xs">
						{en}
					</span>
				)}
			</span>
			{children}
			{help && <p className="text-[13px] text-muted-foreground">{help}</p>}
		</div>
	);
}
