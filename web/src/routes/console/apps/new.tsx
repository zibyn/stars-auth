import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { FormError, FormField } from "#/components/form";
import { Button, buttonVariants } from "#/components/ui/button";
import { FieldGroup } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { createSchema, typeName } from "#/lib/apps";
import { type Application, api } from "#/lib/console-api";
import {
	lines,
	newSecrets,
	type Platform,
	platformKeys,
	platforms,
} from "#/lib/onboarding";
import { applicationsQuery } from "#/routes/console/apps/index";
import { type Header, useCan } from "#/routes/console/route";

const search = z.object({
	platform: z.enum(platformKeys).optional().catch(undefined),
});

export const Route = createFileRoute("/console/apps/new")({
	staticData: { crumb: "创建应用", useHeader },
	validateSearch: search,
	component: CreateApplication,
});

// useHeader titles the platform choice, or the form once one is picked;
// without the Permission there's no header, only the note.
function useHeader(): Header | null {
	const { platform } = useSearch({ from: "/console/apps/new" });
	const can = useCan();
	if (!can("applications:write")) {
		return null;
	}
	if (!platform) {
		return {
			title: "创建应用",
			description:
				"你的用户在哪里登录？选一个最接近的，认证服务会按它准备好设置。",
		};
	}
	const p = platforms[platform];
	return {
		title: `创建${p.name}`,
		description: `${typeName[p.type]}。类型创建后不能更改。`,
		actions: (
			<Link
				to="/console/apps/new"
				search={{}}
				className={buttonVariants({ variant: "outline" })}
			>
				换个平台
			</Link>
		),
	};
}

// CreateApplication asks where users sign in, then only the name and, for
// the web, the callback address. Everything else waits for the
// Application's page.
function CreateApplication() {
	const { platform } = Route.useSearch();
	const can = useCan();
	return (
		<div className="max-w-3xl space-y-6">
			{!can("applications:write") ? (
				<p className="text-sm">需要「管理员」角色才能创建应用。</p>
			) : platform ? (
				<CreateForm platform={platform} />
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{platformKeys.map((k) => (
						<Link
							key={k}
							from={Route.fullPath}
							search={{ platform: k }}
							className="space-y-1 rounded-xl border p-6 hover:border-primary"
						>
							<p className="font-semibold text-[15px]">{platforms[k].name}</p>
							<p className="text-muted-foreground">{platforms[k].desc}</p>
							<p className="pt-2 text-[13px] text-faint">
								{typeName[platforms[k].type]}
							</p>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

function CreateForm({ platform }: { platform: Platform }) {
	const p = platforms[platform];
	const client = useQueryClient();
	const navigate = useNavigate();
	const save = useMutation({
		mutationFn: (v: { name: string; redirectUris: string }) =>
			api<{ application: Application; secret?: string }>("/applications", {
				method: "POST",
				body: {
					type: p.type,
					settings: {
						name: v.name.trim(),
						redirectUris: lines(v.redirectUris),
						postLogoutRedirectUris: [],
						refreshTokens: true,
						appleAppIds: [],
						androidApps: [],
					},
				},
			}),
		onSuccess: async ({ application, secret }) => {
			if (secret) {
				newSecrets.set(application.clientId, secret);
			}
			await client.invalidateQueries(applicationsQuery);
			navigate({
				to: "/console/apps/$clientId",
				params: { clientId: application.clientId },
				search: { onboarding: platform },
			});
		},
	});
	const form = useForm({
		defaultValues: { name: "", redirectUris: "" },
		validationLogic: revalidateLogic(),
		validators: { onDynamic: createSchema(!!p.redirect) },
		onSubmit: ({ value }) => save.mutate(value),
	});
	return (
		<form
			noValidate
			className="space-y-6"
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<FieldGroup className="gap-6">
				<form.Field name="name">
					{(field) => (
						<FormField field={field} label="名称">
							{(control) => <Input {...control} placeholder="如：星选商城" />}
						</FormField>
					)}
				</form.Field>
				{p.redirect && (
					<form.Field name="redirectUris">
						{(field) => (
							<FormField
								field={field}
								label="回调地址"
								en="redirect URI"
								help="登录完成后跳回应用的地址。只接受这里登记过的地址。"
							>
								{(control) => (
									<Textarea
										{...control}
										className="font-mono"
										placeholder={`每行一个，如 https://shop.example.com/${platform === "spa" ? "callback" : "auth/callback"}`}
									/>
								)}
							</FormField>
						)}
					</form.Field>
				)}
			</FieldGroup>
			<FormError error={save.error} />
			<Button type="submit" disabled={save.isPending}>
				创建应用
			</Button>
		</form>
	);
}
