import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestReactScopeRuntime } from "../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { useAttrs } from "../hooks/useAttrs";
import { renderInRootScope } from "../test/renderSolid";
import { Many } from "./Many";

describe("Many", () => {
	test("iterates rel scopes while children read attrs in their own scope", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { first: { name: "First" }, second: { name: "Second" } },
			relsByNodeId: { root: { items: ["first", "second"] } },
		});
		const Item = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<Many rel="items" item={Item} />
		));

		expect(view.texts()).toEqual(["First", "Second"]);
		view.unmount();
	});

	test("rel update keeps existing rows and creates only the new one", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { first: { name: "First" }, second: { name: "Second" } },
			relsByNodeId: { root: { items: ["first"] } },
		});
		const created: string[] = [];
		const Item = () => {
			const attrs = useAttrs(["name"]);
			created.push(String(attrs.name()));
			return <text>{String(attrs.name())}</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<Many rel="items" item={Item} />
		));

		view.flushSync(() =>
			runtime.updateMany("root", "items", ["first", "second"]),
		);

		expect(view.texts()).toEqual(["First", "Second"]);
		expect(created).toEqual(["First", "Second"]);
		view.unmount();
	});

	test("removing an item disposes only its subscriptions and shapes", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { first: { name: "First" }, second: { name: "Second" } },
			relsByNodeId: { root: { items: ["first", "second"] } },
		});
		const Item = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<Many rel="items" item={Item} />
		));

		view.flushSync(() => runtime.updateMany("root", "items", ["second"]));

		expect(view.texts()).toEqual(["Second"]);
		expect(
			runtime.attrSubscriptions.map((s) => [s.scopeNodeId, s.active]),
		).toEqual([
			["first", false],
			["second", true],
		]);
		view.unmount();
	});

	test("renders empty content and honours limit", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { first: { name: "First" }, second: { name: "Second" } },
			relsByNodeId: { root: { items: [], more: ["first", "second"] } },
		});
		const Item = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};

		const view = renderInRootScope(runtime, () => (
			<>
				<Many rel="items" item={Item} empty={<text>Nothing</text>} />
				<Many rel="more" item={Item} limit={1} />
			</>
		));

		expect(view.texts()).toEqual(["Nothing", "First"]);
		view.unmount();
	});
});

describe("Many reactive rel", () => {
	test("changing rel switches the listed rows", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { a: { name: "A" }, b: { name: "B" } },
			relsByNodeId: { root: { listA: ["a"], listB: ["b"] } },
		});
		const Item = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};
		const [rel, setRel] = createSignal("listA");

		const view = renderInRootScope(runtime, () => (
			<Many rel={rel()} item={Item} />
		));

		expect(view.texts()).toEqual(["A"]);

		view.flushSync(() => setRel("listB"));

		expect(view.texts()).toEqual(["B"]);
		expect(
			runtime.shapeMounts
				.filter((m) => m.scopeNodeId === "root")
				.map((m) => [m.rels, m.released]),
		).toEqual([
			[["listA"], true],
			[["listB"], false],
		]);
		view.unmount();
	});
});
