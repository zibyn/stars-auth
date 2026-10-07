import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ConfirmDialog } from "#/components/console";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { api, type SigningKey } from "#/lib/console-api";
import { useCan } from "./console";
import { PolicyNumber } from "./console.login";

export const Route = createFileRoute("/console/settings")({
	component: Settings,
});

const date = (s: string) => new Date(s).toLocaleString("zh-CN");

function Settings() {
	return (
		<>
			<SigningKeys />
			<PolicyNumber
				title="审计保留期"
				field="auditRetentionDays"
				label="审计保留期(天)"
				min={1}
			/>
		</>
	);
}

function SigningKeys() {
	const can = useCan();
	const client = useQueryClient();
	const keys = useQuery({
		queryKey: ["signing-keys"],
		queryFn: () => api<{ keys: SigningKey[] }>("/signing-keys"),
	});
	const rotate = useMutation({
		mutationFn: () => api("/signing-keys/rotate", { method: "POST" }),
		onSuccess: () => client.invalidateQueries({ queryKey: ["signing-keys"] }),
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>签名密钥</CardTitle>
				<p className="text-muted-foreground text-sm">
					当前密钥签发令牌;轮换后,上一个密钥只用来验证它签过的令牌。
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				{keys.error && (
					<p className="text-destructive text-sm">{keys.error.message}</p>
				)}
				<ul className="space-y-2 text-sm">
					{keys.data?.keys.map((k) => (
						<li key={k.kid} className="flex items-center gap-3">
							<span className="font-mono">{k.kid}</span>
							<span className="text-muted-foreground text-xs">
								{k.current ? "当前" : "已退役"} · 创建于 {date(k.createdAt)}
							</span>
						</li>
					))}
				</ul>
				{rotate.error && (
					<p className="text-destructive text-sm">{rotate.error.message}</p>
				)}
				{can("keys:rotate") && (
					<ConfirmDialog
						trigger={
							<Button variant="outline" disabled={rotate.isPending}>
								轮换
							</Button>
						}
						title="轮换令牌签名密钥？"
						action="轮换密钥"
						onConfirm={() => rotate.mutate()}
					>
						轮换后，更早的密钥将被删除，它签发且未过期的令牌随即失效。
					</ConfirmDialog>
				)}
			</CardContent>
		</Card>
	);
}
