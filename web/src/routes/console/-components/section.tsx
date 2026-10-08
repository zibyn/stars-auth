// Page layout only. If shadcn has the component, use components/ui (ADR 0009).

import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";

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
