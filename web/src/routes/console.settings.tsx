import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ConfirmDialog } from "#/components/console";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { api, type SigningKey } from "#/lib/console-api";
import {
	asksShorterRetention,
	lastRotation,
	rotatedRecently,
} from "#/lib/login";
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
				label="保留多久"
				suffix="天"
				help="审计记录保存这么多天，超过的会自动删除。审计页和概览只能查到这段时间内的记录。"
				min={1}
				confirm={{
					when: asksShorterRetention,
					title: "缩短审计保留期？",
					action: "缩短保留期",
					body: "超过新期限的记录会在一小时内删除，不能恢复。",
				}}
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
	const list = keys.data?.keys ?? [];
	const current = list.find((k) => k.current);
	const rotated = lastRotation(list);
	const recent = !!rotated && rotatedRecently(rotated);
	return (
		<Card>
			<CardHeader>
				<CardTitle>令牌签名密钥</CardTitle>
				<p className="text-muted-foreground text-sm">
					认证服务用当前密钥给令牌签名。轮换后，上一把密钥只用来验证它签过的令牌。
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				{keys.error && (
					<p className="text-destructive text-sm">{keys.error.message}</p>
				)}
				{current && (
					<p className="text-sm">
						{rotated
							? `上次轮换于 ${date(rotated)}`
							: `还没有轮换过，当前密钥创建于 ${date(current.createdAt)}`}
					</p>
				)}
				<ul className="space-y-2 text-sm">
					{list.map((k) => (
						<li key={k.kid} className="flex items-center gap-3">
							<span className="font-mono">{k.kid}</span>
							<span className="text-muted-foreground text-xs">
								{k.current ? "当前" : "上一把"} · 创建于 {date(k.createdAt)}
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
								轮换签名密钥
							</Button>
						}
						title="轮换令牌签名密钥？"
						action="轮换签名密钥"
						onConfirm={() => rotate.mutate()}
					>
						<p>
							{rotated ? `上次轮换于 ${date(rotated)}。` : "还没有轮换过。"}
							新密钥会开始签发令牌，上一把密钥仍能验证它签过的令牌。更早的密钥会被删除，它签发且未过期的令牌随即失效。
						</p>
						{recent && (
							<p className="mt-2 font-medium text-destructive">
								距上次轮换不到 1
								天。再次轮换会让上一把密钥签发的令牌立即失效，刚登录的用户可能要重新登录。
							</p>
						)}
					</ConfirmDialog>
				)}
			</CardContent>
		</Card>
	);
}
