import { revalidateLogic, useForm } from "@tanstack/react-form";
import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { FormField, saved } from "#/components/form";
import { Input } from "#/components/ui/input";
import { api, type Policy } from "#/lib/console-api";
import { numberSchema } from "#/lib/login";
import { ConfirmDialog } from "#/routes/console/-components/confirm-dialog";
import { SaveBar, Section } from "#/routes/console/-components/section";
import { useCan } from "#/routes/console/route";

const settingsKey = ["settings"];

export const policyQuery = queryOptions({
	queryKey: settingsKey,
	queryFn: () => api<Policy>("/settings"),
});

export function usePolicy() {
	const can = useCan();
	const policy = useSuspenseQuery(policyQuery).data;
	return { policy, editable: can("config:write") };
}

// useSavePolicy saves one section: PUT /settings takes the whole Policy, so
// the rest goes back as it was, read from the cache. A save writes what it
// sent into the cache at once, so another section's save before the refetch
// doesn't undo it. It toasts 已保存 itself.
export function useSavePolicy() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: async (patch: Partial<Policy>) => {
			const body = { ...client.getQueryData<Policy>(settingsKey), ...patch };
			await api("/settings", { method: "PUT", body });
			return body;
		},
		onSuccess: (body) => {
			client.setQueryData(settingsKey, body);
			saved();
			return client.invalidateQueries({ queryKey: settingsKey });
		},
	});
}

// PolicyNumber edits one numeric setting in its own section. warning shows
// under the field as it is typed; confirm, when it applies to the change,
// asks before saving.
type PolicyNumberProps = {
	title: string;
	field: "dailySendLimit" | "auditRetentionDays";
	label: string;
	suffix: string;
	help: string;
	min: number;
	warning?: (value: number) => ReactNode;
	confirm?: {
		when: (before: number, after: number) => boolean;
		title: string;
		action: string;
		body: ReactNode;
	};
};

export function PolicyNumber(props: PolicyNumberProps) {
	const { policy, editable } = usePolicy();
	return (
		<NumberForm {...props} current={policy[props.field]} editable={editable} />
	);
}

function NumberForm({
	current,
	editable,
	title,
	field,
	label,
	suffix,
	help,
	min,
	warning,
	confirm,
}: PolicyNumberProps & {
	current: number;
	editable: boolean;
}) {
	const save = useSavePolicy();
	const [asking, setAsking] = useState<number>();
	const write = (n: number) => save.mutate({ [field]: n });
	const form = useForm({
		defaultValues: { value: String(current) },
		validationLogic: revalidateLogic(),
		validators: { onDynamic: numberSchema(min) },
		onSubmit: ({ value }) => {
			const next = Number(value.value.trim());
			if (confirm?.when(current, next)) {
				setAsking(next);
			} else {
				write(next);
			}
		},
	});
	return (
		<Section
			title={title}
			editable={editable}
			form={form}
			footer={editable && <SaveBar save={save} />}
		>
			<form.Field name="value">
				{(f) => (
					<FormField field={f} label={label} help={help}>
						{(control) => (
							<>
								<div className="flex items-center gap-2">
									<Input
										{...control}
										type="number"
										min={min}
										className="w-32"
									/>
									<span className="text-sm">{suffix}</span>
								</div>
								{f.state.value !== "" && warning?.(Number(f.state.value))}
							</>
						)}
					</FormField>
				)}
			</form.Field>
			{confirm && (
				<ConfirmDialog
					open={asking !== undefined}
					onOpenChange={(o) => !o && setAsking(undefined)}
					title={confirm.title}
					action={confirm.action}
					onConfirm={() => asking !== undefined && write(asking)}
				>
					{confirm.body}
				</ConfirmDialog>
			)}
		</Section>
	);
}
