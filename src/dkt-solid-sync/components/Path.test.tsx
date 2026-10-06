import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestReactScopeRuntime } from "../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { useAttrs } from "../hooks/useAttrs";
import { renderInRootScope } from "../test/renderSolid";
import { Path } from "./Path";

describe("Path", () => {
	test("walks nested rels and reads attrs in the resolved leaf scope", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { project: { name: "Project A" } },
			relsByNodeId: {
				root: { session: "session" },
				session: { activeProject: "project" },
			},
		});
		const Leaf = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<Path rels={["session", "activeProject"]}>
				<Leaf />
			</Path>
		));

		expect(view.texts()).toEqual(["Project A"]);
		view.unmount();
	});

	test("renders the fallback when a rel in the path is missing", () => {
		const runtime = createTestReactScopeRuntime({
			relsByNodeId: { root: { session: "session" }, session: {} },
		});

		const view = renderInRootScope(runtime, () => (
			<Path rels={["session", "activeProject"]} fallback={<text>Waiting</text>}>
				<text>Leaf</text>
			</Path>
		));

		expect(view.texts()).toEqual(["Waiting"]);
		view.unmount();
	});
});

describe("Path reactive rels", () => {
	test("changing rels resubscribes and releases the old shape demand", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { a: { name: "A" }, b: { name: "B" } },
			relsByNodeId: { root: { relA: "a", relB: "b" } },
		});
		const Leaf = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};
		const [rels, setRels] = createSignal<readonly string[]>(["relA"]);

		const view = renderInRootScope(runtime, () => (
			<Path rels={rels()}>
				<Leaf />
			</Path>
		));

		expect(view.texts()).toEqual(["A"]);

		view.flushSync(() => setRels(["relB"]));

		expect(view.texts()).toEqual(["B"]);
		expect(
			runtime.shapeMounts
				.filter((m) => m.scopeNodeId === "root")
				.map((m) => [m.rels, m.released]),
		).toEqual([
			[["relA"], true],
			[["relB"], false],
		]);
		view.unmount();
	});
});
