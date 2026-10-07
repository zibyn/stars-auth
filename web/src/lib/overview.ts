// The overview's 上手清单 (docs/spec/consoles.md「概览」). Pure TypeScript:
// tested with node --test.
import { onlyBuiltin } from "./apps.ts";
import type { Application, ChannelSettings } from "./console-api.ts";

type Builtin = Pick<Application, "builtin">;

// checklist lists the steps of a first setup the admin can see, with
// whether each is done: a channel enabled, then an Application and an API
// resource of their own. Undefined while a visible step's data is loading.
export const checklist = (
	permissions: readonly string[],
	data: {
		channels?: Pick<ChannelSettings, "kind">[];
		apps?: Builtin[];
		apis?: Builtin[];
	},
) => {
	const steps = [
		{
			label: "配置通道",
			to: "/console/login/channels",
			permission: "config:read",
			done: data.channels && data.channels.length > 0,
		},
		{
			label: "创建应用",
			to: "/console/apps",
			permission: "applications:read",
			done: data.apps && !onlyBuiltin(data.apps),
		},
		{
			label: "添加 API 资源",
			to: "/console/apis",
			permission: "applications:read",
			done: data.apis && !onlyBuiltin(data.apis),
		},
	] as const;
	const visible = steps.filter((s) => permissions.includes(s.permission));
	return visible.every((s) => s.done !== undefined)
		? visible.map((s) => ({ ...s, done: !!s.done }))
		: undefined;
};

// checklistDone: every visible step is done. The page then remembers the
// checklist as closed: it is one-off onboarding, not an ongoing health
// check, so undoing a step later doesn't bring it back.
export const checklistDone = (steps: ReturnType<typeof checklist>) =>
	!!steps?.length && steps.every((s) => s.done);

// showChecklist: shown until it is done or the admin closes it.
export const showChecklist = (
	steps: ReturnType<typeof checklist>,
	closed: boolean,
) => !closed && !!steps?.some((s) => !s.done);
