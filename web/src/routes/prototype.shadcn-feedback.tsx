// PROTOTYPE (throwaway, branch prototype/shadcn-feedback) for #75 and #76:
// Sonner plain vs richColors; Item outline / muted / plain-with-separators;
// success Badge as a tint or a dot. Real shadcn components, no API calls.
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Panel } from "#/components/console";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemSeparator,
	ItemTitle,
} from "#/components/ui/item";
import { Toaster } from "#/components/ui/sonner";

export const Route = createFileRoute("/prototype/shadcn-feedback")({
	component: Prototype,
});

const sessions = [
	{ app: "导航 App", device: "iPhone 15 · 上海", at: "2 分钟前" },
	{ app: "管理端", device: "Chrome · macOS · 杭州", at: "昨天 21:14" },
	{ app: "导航 App", device: "Pixel 8 · 北京", at: "10 月 3 日" },
];

function Prototype() {
	const [rich, setRich] = useState(false);
	return (
		<div className="min-h-screen bg-canvas p-6">
			<Toaster theme="light" position="bottom-right" richColors={rich} />
			<Panel className="mx-auto max-w-3xl space-y-12 p-8">
				<section className="space-y-4">
					<h2 className="font-semibold text-[15px]">#75 · Toast 样式</h2>
					<div className="flex flex-wrap gap-2">
						{(["A", "B"] as const).map((k) => (
							<Button
								key={k}
								variant={rich === (k === "B") ? "default" : "outline"}
								onClick={() => setRich(k === "B")}
							>
								{k === "A" ? "A 朴素" : "B richColors"}
							</Button>
						))}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => toast.success("已保存")}>
							保存成功
						</Button>
						<Button
							variant="outline"
							onClick={() =>
								toast.error("轮换 client secret 失败", {
									description: "网络连接中断,请重试",
									duration: Number.POSITIVE_INFINITY,
									closeButton: true,
								})
							}
						>
							操作失败
						</Button>
					</div>
				</section>

				<section className="space-y-6">
					<h2 className="font-semibold text-[15px]">#76 · 列表样式(会话)</h2>
					{(["outline", "muted", "plain"] as const).map((v, i) => (
						<div key={v} className="space-y-2">
							<p className="text-[13px] text-muted-foreground">
								{"ABC"[i]} · {v === "plain" ? "无底色 + 分隔线" : v}
							</p>
							<ItemGroup className={v === "plain" ? "gap-0" : "gap-2"}>
								{sessions.map((s, j) => (
									<Fragment key={s.device}>
										{v === "plain" && j > 0 && (
											<ItemSeparator className="my-0" />
										)}
										<Item variant={v === "plain" ? "default" : v}>
											<ItemContent>
												<ItemTitle>{s.app}</ItemTitle>
												<ItemDescription>
													{s.device} · {s.at}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Button variant="outline" size="sm">
													结束会话
												</Button>
											</ItemActions>
										</Item>
									</Fragment>
								))}
							</ItemGroup>
						</div>
					))}
				</section>

				<section className="space-y-4">
					<h2 className="font-semibold text-[15px]">#76 · success 徽章</h2>
					<div className="flex items-center gap-6 text-sm">
						<span className="flex items-center gap-2">
							A 淡绿底
							<Badge className="bg-green-500/10 text-green-700">正常</Badge>
						</span>
						<span className="flex items-center gap-2">
							B 圆点
							<Badge variant="outline">
								<span className="size-1.5 rounded-full bg-green-600" />
								正常
							</Badge>
						</span>
						<span className="flex items-center gap-2">
							对照 destructive
							<Badge variant="destructive">已禁用</Badge>
						</span>
					</div>
				</section>
			</Panel>
		</div>
	);
}
