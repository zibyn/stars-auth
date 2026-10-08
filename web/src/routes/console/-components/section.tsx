// Page layout only. If shadcn has the component, use components/ui (ADR 0009).

import type { ReactNode } from "react";
import { FormError } from "#/components/form";
import { Button } from "#/components/ui/button";
import { FieldSet } from "#/components/ui/field";

// Section is a section title and its content, no card around it. With a
// TanStack form the content is that form: children are what an editor may
// change, extra stays usable for readers (copying client_id). Without one
// the rows act on their own. Put sections in a space-y-10 parent for the
// 40px between.
export function Section({
	title,
	intro,
	editable = true,
	form,
	extra,
	footer,
	children,
}: {
	title: string;
	intro?: ReactNode;
	editable?: boolean;
	form?: { handleSubmit: () => unknown };
	extra?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section>
			<SectionHeading title={title} intro={intro} />
			{form ? (
				<form
					noValidate
					className="mt-4 space-y-6"
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<FieldSet disabled={!editable} className="gap-6">
						{children}
					</FieldSet>
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

// SaveBar is a section's save button, under why the server turned the
// last save down. A save that goes through says so in a toast.
export function SaveBar({
	save,
}: {
	save: { isPending: boolean; error: Error | null };
}) {
	return (
		<>
			<FormError error={save.error} />
			<Button type="submit" disabled={save.isPending}>
				保存
			</Button>
		</>
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
