// Forms and feedback shared by the console and the account center
// (ADR 0009): TanStack Form fields in shadcn Field, the server's refusal
// in an Alert, page-level failures in a toast.

import type { AnyFieldApi } from "@tanstack/react-form";
import { type ChangeEvent, type ReactNode, useId } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "#/components/ui/alert";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/ui/field";

// FormField lays out one TanStack Form field: label, control, help and
// its error. children gets the props that tie a text control to the
// field; a Switch or Select takes only id and aria-invalid from them.
export function FormField({
	field,
	label,
	en,
	help,
	children,
}: {
	field: AnyFieldApi;
	label: ReactNode;
	en?: string; // the original term, in small print beside the label
	help?: ReactNode;
	children: (control: {
		id: string;
		name: string;
		value: string;
		onBlur: () => void;
		onChange: (e: ChangeEvent<{ value: string }>) => void;
		"aria-invalid": boolean;
	}) => ReactNode;
}) {
	const id = useId();
	const invalid = !field.state.meta.isValid;
	return (
		<Field data-invalid={invalid}>
			<FieldLabel htmlFor={id}>
				{label}
				{en && (
					<span className="font-normal text-muted-foreground text-xs">
						{en}
					</span>
				)}
			</FieldLabel>
			{children({
				id,
				name: field.name,
				value: field.state.value,
				onBlur: field.handleBlur,
				onChange: (e) => field.handleChange(e.target.value),
				"aria-invalid": invalid,
			})}
			{help && <FieldDescription>{help}</FieldDescription>}
			{invalid && <FieldError errors={field.state.meta.errors} />}
		</Field>
	);
}

// FormError is why the server turned a form down, inside the form.
export function FormError({ error }: { error: Error | null }) {
	return (
		error && (
			<Alert variant="destructive">
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		)
	);
}

// saved is the toast for a save that went through.
export const saved = () => toast.success("已保存");

// failed makes a mutation's onError for an action outside a form: the
// toast names what failed and stays until closed.
export const failed = (what: string) => (error: Error) =>
	toast.error(what, {
		description: error.message,
		duration: Number.POSITIVE_INFINITY,
		closeButton: true,
	});
