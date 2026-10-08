// PROTOTYPE (throwaway, branch prototype/settings-tabs): which shadcn Tabs
// look fits the merged 设置 page? Three variants via ?variant=A|B|C, the
// console shell drawn statically, no API calls.
// No dark toggle: the console has no dark theme yet (.dark is shadcn's stock).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { Field, Panel, SaveBar, Section } from "#/components/console";
import { Star } from "#/components/star";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

export const Route = createFileRoute("/prototype/settings-tabs")({
	validateSearch: z.object({
		variant: z.enum(["A", "B", "C"]).catch("A"),
	}),
	component: Prototype,
});

const variants = {
	A: "default：灰底胶囊",
	B: "line：黑色下划线（shadcn 原样）",
	C: "line + 主色下划线（最像现在）",
} as const;
type Key = keyof typeof variants;
const keys = Object.keys(variants) as Key[];

const groups = ["概览", "用户", "应用", "API 资源", "审计", "设置"];
const idle = { isPending: false, isSuccess: false, error: null };

function Prototype() {
	const { variant } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const go = (step: number) =>
		navigate({
			search: (s) => ({
				...s,
				variant: keys[(keys.indexOf(variant) + step + keys.length) % 3],
			}),
			replace: true,
		});

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement).closest("input,textarea,[contenteditable]"))
				return;
			if (e.key === "ArrowLeft") go(-1);
			if (e.key === "ArrowRight") go(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<div className="flex min-h-svh bg-canvas p-2 text-sm">
			<aside className="sticky top-2 flex h-[calc(100svh-1rem)] w-60 shrink-0 flex-col p-4">
				<div className="flex items-center gap-3 px-2 py-2">
					<span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
						<Star className="size-4" />
					</span>
					<span className="leading-tight">
						<span className="block font-semibold">Stars</span>
						<span className="block text-muted-foreground text-xs">Auth</span>
					</span>
				</div>
				<nav className="mt-6 space-y-1">
					{groups.map((g) => (
						<span
							key={g}
							className={
								g === "设置"
									? "flex rounded-lg bg-card px-3 py-2 font-medium shadow-xs ring-1 ring-border"
									: "flex px-3 py-2 text-muted-foreground"
							}
						>
							{g}
						</span>
					))}
				</nav>
				<div className="mt-auto flex items-center gap-3 px-3">
					<span className="grid size-6 place-items-center rounded-full bg-primary-soft text-primary-ink">
						<UserRound className="size-3.5" />
					</span>
					<span className="font-mono text-muted-foreground text-xs">admin</span>
				</div>
			</aside>
			<Panel className="min-w-0 flex-1 px-14 py-11">
				<div className="max-w-4xl space-y-6">
					<h1 className="font-semibold text-2xl tracking-tight">设置</h1>
					<Tabs defaultValue="login" className="gap-6">
						<TabsList
							variant={variant === "A" ? "default" : "line"}
							className={
								variant === "C"
									? "w-full justify-start border-b pb-0 [&>*]:flex-none [&>*]:px-3 [&>*]:after:bottom-[-1px] [&>*]:after:bg-primary"
									: undefined
							}
						>
							<TabsTrigger value="login">登录方式</TabsTrigger>
							<TabsTrigger value="channels">通道</TabsTrigger>
							<TabsTrigger value="security">安全</TabsTrigger>
						</TabsList>
						<TabsContent value="login" className="space-y-10">
							<Section
								title="密码登录"
								onSubmit={() => {}}
								footer={<SaveBar save={idle} />}
							>
								<Field
									label="密码登录范围"
									help="用户可以用手机号、邮箱或用户名加密码登录。关闭后，已经设置的密码会保留，但不能用来登录。"
								>
									<Input className="w-48" defaultValue="全部登录标识" />
								</Field>
							</Section>
							<Section
								title="必须绑定手机号"
								onSubmit={() => {}}
								footer={<SaveBar save={idle} outline />}
							>
								<Field
									label="开启"
									help="开启后，没有手机号的用户登录时要先绑定。"
								>
									<Switch />
								</Field>
							</Section>
						</TabsContent>
						<TabsContent value="channels">
							<Section
								title="短信"
								intro="没开启时，用户不能用手机号收验证码登录。"
								onSubmit={() => {}}
								footer={<SaveBar save={idle} />}
							>
								<Field label="启用">
									<Switch defaultChecked />
								</Field>
							</Section>
						</TabsContent>
						<TabsContent value="security" className="space-y-10">
							<Section
								title="令牌签名密钥"
								intro="认证服务用当前密钥给令牌签名。"
							>
								<Button variant="outline">轮换签名密钥</Button>
							</Section>
							<Section
								title="审计保留期"
								onSubmit={() => {}}
								footer={<SaveBar save={idle} outline />}
							>
								<Field label="保留多久">
									<div className="flex items-center gap-2">
										<Input type="number" className="w-32" defaultValue={90} />
										<span>天</span>
									</div>
								</Field>
							</Section>
						</TabsContent>
					</Tabs>
				</div>
			</Panel>
			{import.meta.env.DEV && (
				<div className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-neutral-900 px-2 py-1.5 text-white shadow-lg">
					<button type="button" className="p-1" onClick={() => go(-1)}>
						<ChevronLeft className="size-4" />
					</button>
					<span className="min-w-56 text-center">
						{variant} · {variants[variant]}
					</span>
					<button type="button" className="p-1" onClick={() => go(1)}>
						<ChevronRight className="size-4" />
					</button>
				</div>
			)}
		</div>
	);
}
