import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog } from "#/components/console";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import type { Policy } from "#/lib/console-api";
import { PolicyField, usePolicy } from "./console.login";

export const Route = createFileRoute("/console/login/")({
	component: LoginPolicy,
});

const passwordModes = { off: "关闭", admins: "仅管理员", all: "所有 User" };

type LoginFields = Pick<
	Policy,
	"passwordLogin" | "requirePhone" | "termsUrl" | "privacyUrl" | "termsVersion"
>;

function LoginPolicy() {
	const { policy, save, editable } = usePolicy();
	return (
		<Card>
			<CardHeader>
				<CardTitle>登录策略</CardTitle>
			</CardHeader>
			<CardContent>
				{policy.error && (
					<p className="text-destructive text-sm">{policy.error.message}</p>
				)}
				{policy.data && (
					<PolicyForm
						key={JSON.stringify(policy.data)}
						current={policy.data}
						editable={editable}
						saving={save.isPending}
						error={save.error?.message}
						onSave={(p) => save.mutate(p)}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function PolicyForm({
	current,
	editable,
	saving,
	error,
	onSave,
}: {
	current: Policy;
	editable: boolean;
	saving: boolean;
	error?: string;
	onSave: (p: LoginFields) => void;
}) {
	const [passwordLogin, setPasswordLogin] = useState(current.passwordLogin);
	const [requirePhone, setRequirePhone] = useState(current.requirePhone);
	// A changed terms version waits here for the admin to confirm it.
	const [pending, setPending] = useState<LoginFields>();
	return (
		<form
			className="grid gap-4 sm:grid-cols-2"
			onSubmit={(e) => {
				e.preventDefault();
				const f = new FormData(e.currentTarget);
				const text = (k: string) => `${f.get(k) ?? ""}`.trim();
				const version = text("termsVersion");
				const p = {
					passwordLogin,
					requirePhone,
					termsUrl: text("termsUrl"),
					privacyUrl: text("privacyUrl"),
					termsVersion: version,
				};
				if (current.termsVersion && version !== current.termsVersion) {
					setPending(p);
				} else {
					onSave(p);
				}
			}}
		>
			<div className="grid gap-1.5">
				<Label>密码登录</Label>
				<Select
					value={passwordLogin}
					disabled={!editable}
					onValueChange={(v) => setPasswordLogin(v as Policy["passwordLogin"])}
				>
					<SelectTrigger aria-label="密码登录">
						<SelectValue>
							{(v: Policy["passwordLogin"]) => passwordModes[v]}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{Object.entries(passwordModes).map(([k, label]) => (
							<SelectItem key={k} value={k}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-xs">
					关闭期间,已设的密码保留但不能用
				</p>
			</div>
			<div className="flex items-center gap-2 self-start pt-7">
				<Switch
					id="requirePhone"
					checked={requirePhone}
					disabled={!editable}
					onCheckedChange={setRequirePhone}
				/>
				<Label htmlFor="requirePhone">必须绑定手机号</Label>
			</div>
			<PolicyField label="《用户协议》URL">
				<Input
					id="termsUrl"
					name="termsUrl"
					type="url"
					disabled={!editable}
					defaultValue={current.termsUrl}
				/>
			</PolicyField>
			<PolicyField label="《隐私政策》URL">
				<Input
					id="privacyUrl"
					name="privacyUrl"
					type="url"
					disabled={!editable}
					defaultValue={current.privacyUrl}
				/>
			</PolicyField>
			<PolicyField
				label="协议版本"
				help="登录时须勾选同意;改动后 User 下次登录须重新同意。留空则不要求同意"
			>
				<Input
					id="termsVersion"
					name="termsVersion"
					maxLength={64}
					disabled={!editable}
					defaultValue={current.termsVersion}
				/>
			</PolicyField>
			{error && (
				<p className="text-destructive text-sm sm:col-span-2">{error}</p>
			)}
			<ConfirmDialog
				open={!!pending}
				onOpenChange={(o) => !o && setPending(undefined)}
				title="更新协议版本？"
				destructive={false}
				action="更新协议版本"
				onConfirm={() => pending && onSave(pending)}
			>
				改动协议版本后，所有 User 下次登录时都须重新同意。
			</ConfirmDialog>
			{editable && (
				<div className="sm:col-span-2">
					<Button type="submit" disabled={saving}>
						保存
					</Button>
				</div>
			)}
		</form>
	);
}
