import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Input } from "#/components/ui/input";
import { api, type Policy } from "#/lib/console-api";
import { ConfirmDialog } from "#/routes/console/-components/confirm-dialog";
import { Field, SaveBar, Section } from "#/routes/console/-components/section";
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
// doesn't undo it.
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
	const [value, setValue] = useState(String(current));
	const [asking, setAsking] = useState(false);
	const next = Number(value);
	return (
		<Section
			title={title}
			editable={editable}
			onSubmit={() => {
				if (confirm?.when(current, next)) {
					setAsking(true);
				} else {
					save.mutate({ [field]: next });
				}
			}}
			footer={editable && <SaveBar save={save} />}
		>
			<Field label={label} help={help}>
				<div className="flex items-center gap-2">
					<Input
						name={field}
						type="number"
						min={min}
						required
						className="w-32"
						value={value}
						onChange={(e) => setValue(e.target.value)}
					/>
					<span className="text-sm">{suffix}</span>
				</div>
				{value !== "" && warning?.(next)}
			</Field>
			{confirm && (
				<ConfirmDialog
					open={asking}
					onOpenChange={setAsking}
					title={confirm.title}
					action={confirm.action}
					onConfirm={() => save.mutate({ [field]: next })}
				>
					{confirm.body}
				</ConfirmDialog>
			)}
		</Section>
	);
}
