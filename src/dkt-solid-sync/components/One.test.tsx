import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestReactScopeRuntime } from "../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { useAttrs } from "../hooks/useAttrs";
import { renderInRootScope } from "../test/renderSolid";
import { One } from "./One";

const ProjectTitle = () => {
	const attrs = useAttrs(["title"]);
	return <text>{String(attrs.title())}</text>;
};

describe("One", () => {
	test("renders a one-rel child with attrs read in the child scope", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { project: { title: "Project A" } },
			relsByNodeId: { root: { activeProject: "project" } },
		});

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject" fallback={<text>No project</text>}>
				<ProjectTitle />
			</One>
		));

		expect(view.texts()).toEqual(["Project A"]);
		view.unmount();
	});

	test("renders the fallback while the rel is empty and swaps when it fills", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { project: { title: "Project A" } },
			relsByNodeId: { root: { activeProject: null } },
		});

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject" fallback={<text>No project</text>}>
				<ProjectTitle />
			</One>
		));

		expect(view.texts()).toEqual(["No project"]);

		view.flushSync(() => runtime.updateOne("root", "activeProject", "project"));

		expect(view.texts()).toEqual(["Project A"]);
		view.unmount();
	});

	test("updates when the one-rel target changes", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { first: { title: "First" }, second: { title: "Second" } },
			relsByNodeId: { root: { activeProject: "first" } },
		});

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject">
				<ProjectTitle />
			</One>
		));

		expect(view.texts()).toEqual(["First"]);

		view.flushSync(() => runtime.updateOne("root", "activeProject", "second"));

		expect(view.texts()).toEqual(["Second"]);
		// the first child's attr subscription is replaced, not leaked
		expect(
			runtime.attrSubscriptions.map((s) => [s.scopeNodeId, s.active]),
		).toEqual([
			["first", false],
			["second", true],
		]);
		view.unmount();
	});

	test("releases rel and child shape demand on unmount", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { project: { title: "Project A" } },
			relsByNodeId: { root: { activeProject: "project" } },
		});

		const view = renderInRootScope(runtime, () => (
			<One rel="activeProject">
				<ProjectTitle />
			</One>
		));

		expect(runtime.shapeMounts.map((m) => [m.scopeNodeId, m.released])).toEqual(
			[
				["root", false],
				["project", false],
			],
		);

		view.unmount();

		expect(runtime.shapeMounts.every((m) => m.released)).toBe(true);
	});
});

describe("One reactive props", () => {
	test("changing rel switches subscription and releases old shape demand", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { a: { title: "A" }, b: { title: "B" } },
			relsByNodeId: { root: { relA: "a", relB: "b" } },
		});
		const [rel, setRel] = createSignal("relA");

		const view = renderInRootScope(runtime, () => (
			<One rel={rel()}>
				<ProjectTitle />
			</One>
		));

		expect(view.texts()).toEqual(["A"]);

		view.flushSync(() => setRel("relB"));

		expect(view.texts()).toEqual(["B"]);
		const relMounts = runtime.shapeMounts.filter(
			(m) => m.scopeNodeId === "root",
		);
		expect(relMounts.map((m) => [m.rels, m.released])).toEqual([
			[["relA"], true],
			[["relB"], false],
		]);
		view.unmount();
	});

	test("changing readyAttr recreates the gate", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { a: { title: "A" } },
			relsByNodeId: { root: { rel: "a" } },
		});
		const [ready, setReady] = createSignal("title");

		const view = renderInRootScope(runtime, () => (
			<One rel="rel" readyAttr={ready()} fallback={<text>Loading</text>}>
				<ProjectTitle />
			</One>
		));

		expect(view.texts()).toEqual(["A"]);

		view.flushSync(() => setReady("missing"));

		expect(view.texts()).toEqual(["Loading"]);
		view.unmount();
	});
});
