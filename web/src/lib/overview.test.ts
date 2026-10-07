import assert from "node:assert/strict";
import { test } from "node:test";
import { checklist, checklistDone, showChecklist } from "./overview.ts";

const owner = ["users:read", "applications:read", "config:read"];
const builtinOnly = [{ builtin: true }];
const own = [{ builtin: true }, { builtin: false }];
const fresh = { channels: [], apps: builtinOnly, apis: builtinOnly };

const state = (steps: ReturnType<typeof checklist>) =>
	steps?.map((s) => [s.label, s.done]);

test("a fresh install lists all three steps undone, in order", () => {
	assert.deepEqual(state(checklist(owner, fresh)), [
		["配置通道", false],
		["创建应用", false],
		["添加 API 资源", false],
	]);
});

test("a step is done once its first own object exists", () => {
	assert.deepEqual(
		state(
			checklist(owner, {
				channels: [{ kind: "email" }],
				apps: own,
				apis: builtinOnly,
			}),
		),
		[
			["配置通道", true],
			["创建应用", true],
			["添加 API 资源", false],
		],
	);
});

test("steps the admin lacks the Permission for aren't listed", () => {
	assert.deepEqual(state(checklist(["config:read"], { channels: [] })), [
		["配置通道", false],
	]);
	assert.deepEqual(
		state(checklist(["applications:read"], { apps: own, apis: builtinOnly })),
		[
			["创建应用", true],
			["添加 API 资源", false],
		],
	);
	assert.deepEqual(state(checklist(["users:read"], {})), []);
});

test("nothing is listed while a visible step's data is loading", () => {
	assert.equal(checklist(owner, { channels: [], apps: own }), undefined);
});

const done = { channels: [{ kind: "phone" as const }], apps: own, apis: own };

test("the checklist shows while a step is left and it wasn't closed", () => {
	assert.equal(showChecklist(checklist(owner, fresh), false), true);
});

test("the checklist hides once every step is done", () => {
	assert.equal(showChecklist(checklist(owner, done), false), false);
	// Done counts only the steps the admin can see.
	assert.equal(
		showChecklist(
			checklist(["config:read"], { channels: done.channels }),
			false,
		),
		false,
	);
});

test("the checklist hides once closed, while loading, or with no steps", () => {
	assert.equal(showChecklist(checklist(owner, fresh), true), false);
	assert.equal(showChecklist(checklist(owner, {}), false), false);
	assert.equal(showChecklist(checklist(["users:read"], {}), false), false);
});

test("each step is judged on its own data", () => {
	assert.deepEqual(
		state(checklist(owner, { channels: [], apps: [], apis: own })),
		[
			["配置通道", false],
			["创建应用", false],
			["添加 API 资源", true],
		],
	);
});

test("a checklist with every step done is done for good", () => {
	// The page remembers it, so undoing a step later doesn't bring it back.
	assert.equal(checklistDone(checklist(owner, done)), true);
});

test("a checklist with a step left, loading or empty isn't done", () => {
	assert.equal(checklistDone(checklist(owner, fresh)), false);
	assert.equal(checklistDone(checklist(owner, {})), false);
	assert.equal(checklistDone(checklist(["users:read"], {})), false);
});
