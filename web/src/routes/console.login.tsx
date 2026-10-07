import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { api, type Policy } from "#/lib/console-api";
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

// usePolicy loads the login settings and saves part of them: PUT /settings
// takes the whole Policy, so the values a page doesn't show go back as they
// were.
export function usePolicy() {
	const can = useCan();
	const client = useQueryClient();
	const policy = useQuery({
		queryKey: ["settings"],
		queryFn: () => api<Policy>("/settings"),
	});
	const save = useMutation({
		mutationFn: (patch: Partial<Policy>) =>
			api("/settings", {
				method: "PUT",
				body: { ...policy.data, ...patch },
			}),
		onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
	});
	return { policy, save, editable: can("config:write") };
}

export function PolicyField({
	label,
	help,
	children,
}: {
	label: string;
	help?: string;
	children: React.ReactElement<{ id: string }>;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={children.props.id}>{label}</Label>
			{children}
			{help && <p className="text-muted-foreground text-xs">{help}</p>}
		</div>
	);
}

// PolicyNumber edits one numeric login setting in its own card.
export function PolicyNumber({
	title,
	field,
	label,
	help,
	min,
}: {
	title: string;
	field: "dailySendLimit" | "auditRetentionDays";
	label: string;
	help?: string;
	min: number;
}) {
	const { policy, save, editable } = usePolicy();
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{policy.error && (
					<p className="text-destructive text-sm">{policy.error.message}</p>
				)}
				{policy.data && (
					<form
						key={policy.data[field]}
						className="grid gap-4 sm:grid-cols-2"
						onSubmit={(e) => {
							e.preventDefault();
							const f = new FormData(e.currentTarget);
							save.mutate({ [field]: Number(f.get(field)) });
						}}
					>
						<PolicyField label={label} help={help}>
							<Input
								id={field}
								name={field}
								type="number"
								min={min}
								required
								disabled={!editable}
								defaultValue={policy.data[field]}
							/>
						</PolicyField>
						{save.error && (
							<p className="text-destructive text-sm sm:col-span-2">
								{save.error.message}
							</p>
						)}
						{editable && (
							<div className="sm:col-span-2">
								<Button type="submit" disabled={save.isPending}>
									保存
								</Button>
							</div>
						)}
					</form>
				)}
			</CardContent>
		</Card>
	);
}
