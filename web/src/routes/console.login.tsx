import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { ConfirmDialog, Field, SaveBar, Section } from "#/components/console";
import { Input } from "#/components/ui/input";
import {
	api,
	type ChannelPlugin,
	type ChannelSettings,
	type Policy,
} from "#/lib/console-api";
import { useCan } from "./console";

export const Route = createFileRoute("/console/login")({ component: Login });

const tabs = [
	{ label: "登录方式", to: "/console/login" },
	{ label: "通道", to: "/console/login/channels" },
] as const;

function Login() {
	return (
		<>
			<nav className="flex gap-1 border-b">
				{tabs.map((t) => (
					<Link
						key={t.to}
						to={t.to}
						activeOptions={{ exact: true }}
						className="-mb-px border-transparent border-b-2 px-3 py-2 text-muted-foreground text-sm"
						activeProps={{ className: "border-primary text-foreground" }}
					>
						{t.label}
					</Link>
				))}
			</nav>
			<Outlet />
		</>
	);
}

export const channelsQuery = queryOptions({
	queryKey: ["channels"],
	queryFn: () =>
		api<{ plugins: ChannelPlugin[]; channels: ChannelSettings[] }>("/channels"),
});

const settingsKey = ["settings"];

export function usePolicy() {
	const can = useCan();
	const policy = useQuery({
		queryKey: settingsKey,
		queryFn: () => api<Policy>("/settings"),
	});
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
export function PolicyNumber({
	title,
	field,
	label,
	suffix,
	help,
	min,
	warning,
	confirm,
}: {
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
}) {
	const { policy, editable } = usePolicy();
	if (policy.error) {
		return <p className="text-destructive text-sm">{policy.error.message}</p>;
	}
	if (!policy.data) {
		return null;
	}
	const props = { title, field, label, suffix, help, min, warning, confirm };
	return (
		<NumberForm {...props} current={policy.data[field]} editable={editable} />
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
}: Parameters<typeof PolicyNumber>[0] & {
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

// toChannels links to the 通道 page from a hint that needs a channel.
export const toChannels = {
	label: "去设置通道",
	to: "/console/login/channels",
} as const;
