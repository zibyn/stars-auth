import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Field } from "#/components/console";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { typeName } from "#/lib/apps";
import { type Application, api } from "#/lib/console-api";
import {
	lines,
	newSecrets,
	type Platform,
	platformKeys,
	platforms,
} from "#/lib/onboarding";
import { useCan } from "./console";
import { applicationsQuery } from "./console.apps.index";

const search = z.object({
	platform: z.enum(platformKeys).optional().catch(undefined),
});

export const Route = createFileRoute("/console/apps/new")({
	validateSearch: search,
	component: CreateApplication,
});

// CreateApplication asks where users sign in, then only the name and, for
// the web, the callback address. Everything else waits for the
// Application's page.
function CreateApplication() {
	const { platform } = Route.useSearch();
	const can = useCan();
	return (
		<div className="max-w-3xl space-y-6">
			<Link
				to="/console/apps"
				className="text-muted-foreground text-sm hover:underline"
			>
				应用 ›
			</Link>
			{!can("applications:write") ? (
				<p className="text-sm">需要「管理员」角色才能创建应用。</p>
			) : platform ? (
				<CreateForm platform={platform} />
			) : (
				<>
					<div className="space-y-1">
						<h1 className="font-semibold text-2xl">创建应用</h1>
						<p className="text-muted-foreground text-sm">
							你的用户在哪里登录？选一个最接近的，认证服务会按它准备好设置。
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						{platformKeys.map((k) => (
							<Link
								key={k}
								from={Route.fullPath}
								search={{ platform: k }}
								className="space-y-1 rounded-xl border p-5 hover:border-foreground"
							>
								<p className="font-medium">{platforms[k].name}</p>
								<p className="text-muted-foreground text-sm">
									{platforms[k].desc}
								</p>
								<p className="pt-2 text-muted-foreground text-xs">
									{typeName[platforms[k].type]}
								</p>
							</Link>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function CreateForm({ platform }: { platform: Platform }) {
	const p = platforms[platform];
	const client = useQueryClient();
	const navigate = useNavigate();
	const save = useMutation({
		mutationFn: (f: FormData) =>
			api<{ application: Application; secret?: string }>("/applications", {
				method: "POST",
				body: {
					type: p.type,
					settings: {
						name: `${f.get("name")}`,
						redirectUris: lines(f.get("redirectUris")),
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
	return (
		<>
			<div className="space-y-1">
				<Link
					from={Route.fullPath}
					search={{}}
					className="text-muted-foreground text-sm hover:underline"
				>
					← 换个平台
				</Link>
				<h1 className="font-semibold text-2xl">创建{p.name}</h1>
				<p className="text-muted-foreground text-sm">
					{typeName[p.type]}。类型创建后不能更改。
				</p>
			</div>
			<Card>
				<CardContent>
					<form
						className="space-y-5"
						onSubmit={(e) => {
							e.preventDefault();
							save.mutate(new FormData(e.currentTarget));
						}}
					>
						<Field label="名称">
							<Input name="name" required placeholder="如：星选商城" />
						</Field>
						{p.redirect && (
							<Field
								label="回调地址"
								en="redirect URI"
								help="登录完成后跳回应用的地址。只接受这里登记过的地址。"
							>
								<Textarea
									name="redirectUris"
									required
									className="font-mono"
									placeholder={`每行一个，如 https://shop.example.com/${platform === "spa" ? "callback" : "auth/callback"}`}
								/>
							</Field>
						)}
						{save.error && (
							<p className="text-destructive text-sm">{save.error.message}</p>
						)}
						<Button type="submit" disabled={save.isPending}>
							创建应用
						</Button>
					</form>
				</CardContent>
			</Card>
		</>
	);
}
