import { describe, expect, test } from "bun:test";
import { createTestReactScopeRuntime } from "../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { One } from "../components/One";
import { renderInRootScope } from "../test/renderSolid";
import { type ScopeDispatch, useActions, useRootDispatch } from "./useActions";

describe("useActions", () => {
	test("dispatches actions to the current scope", () => {
		const runtime = createTestReactScopeRuntime({
			relsByNodeId: { root: { activeProject: "project" } },
		});
		let dispatch: ScopeDispatch | undefined;
		const Probe = () => {
			dispatch = useActions();
			return <text>Ready</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject">
				<Probe />
			</One>
		));
		dispatch?.("renameProject", { title: "Project B" });

		expect(runtime.dispatchCalls).toEqual([
			{
				actionName: "renameProject",
				payload: { title: "Project B" },
				scopeNodeId: "project",
				meta: undefined,
			},
		]);
		view.unmount();
	});

	test("one stable dispatch follows the scope when the rel changes", () => {
		const runtime = createTestReactScopeRuntime({
			relsByNodeId: { root: { activeProject: "first" } },
		});
		const dispatches: ScopeDispatch[] = [];
		const Probe = () => {
			dispatches.push(useActions());
			return <text>Ready</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject">
				<Probe />
			</One>
		));

		view.flushSync(() => runtime.updateOne("root", "activeProject", "second"));
		dispatches[0]("touch");

		expect(dispatches).toHaveLength(1);
		expect(runtime.dispatchCalls.map((c) => c.scopeNodeId)).toEqual(["second"]);
		view.unmount();
	});

	test("useRootDispatch targets the root scope inside a child scope", () => {
		const runtime = createTestReactScopeRuntime({
			relsByNodeId: { root: { activeProject: "project" } },
		});
		let dispatch: ScopeDispatch | undefined;
		const Probe = () => {
			dispatch = useRootDispatch();
			return <text>Ready</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject">
				<Probe />
			</One>
		));
		dispatch?.("setCursor", { time: 3 }, { source: "test" });

		expect(runtime.dispatchCalls).toEqual([
			{
				actionName: "setCursor",
				payload: { time: 3 },
				scopeNodeId: "root",
				meta: { source: "test" },
			},
		]);
		view.unmount();
	});
});
