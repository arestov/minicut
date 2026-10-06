import { describe, expect, test } from "bun:test";
import { createTestReactScopeRuntime } from "../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { Many } from "../components/Many";
import { One } from "../components/One";
import { useAttrs } from "../hooks/useAttrs";
import { renderInRootScope } from "./renderSolid";

const Name = () => {
	const attrs = useAttrs(["name"]);
	return <text>{String(attrs.name())}</text>;
};

describe("skeleton race: rel arrives before attrs", () => {
	test("One withholds the child until readyAttr arrives", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: {},
			relsByNodeId: { root: { clip: "clip" } },
		});

		const view = renderInRootScope(runtime, () => (
			<One rel="clip" readyAttr="name" fallback={<text>Loading</text>}>
				<Name />
			</One>
		));

		expect(view.texts()).toEqual(["Loading"]);

		view.flushSync(() => runtime.updateAttrs("clip", { name: "Clip A" }));

		expect(view.texts()).toEqual(["Clip A"]);
		view.unmount();
	});

	test("Many withholds only the rows whose readyAttr has not arrived", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { first: { name: "First" } },
			relsByNodeId: { root: { items: ["first", "second"] } },
		});

		const view = renderInRootScope(runtime, () => (
			<Many rel="items" item={Name} readyAttr="name" />
		));

		expect(view.texts()).toEqual(["First"]);

		view.flushSync(() => runtime.updateAttrs("second", { name: "Second" }));

		expect(view.texts()).toEqual(["First", "Second"]);
		view.unmount();
	});

	test("rows of a gated Many release shape demand on unmount", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: {},
			relsByNodeId: { root: { items: ["first"] } },
		});

		const view = renderInRootScope(runtime, () => (
			<Many rel="items" item={Name} readyAttr="name" />
		));

		expect(runtime.shapeMounts.some((m) => !m.released)).toBe(true);

		view.unmount();

		expect(runtime.shapeMounts.every((m) => m.released)).toBe(true);
		expect(runtime.attrSubscriptions.every((s) => !s.active)).toBe(true);
	});
});

describe("stable list", () => {
	test("rows survive reorders and unrelated attr updates without recreation", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { a: { name: "A" }, b: { name: "B" }, c: { name: "C" } },
			relsByNodeId: { root: { items: ["a", "b"] } },
		});
		let created = 0;
		const Item = () => {
			created += 1;
			return <Name />;
		};

		const view = renderInRootScope(runtime, () => (
			<Many rel="items" item={Item} />
		));

		view.flushSync(() => runtime.updateMany("root", "items", ["b", "a", "c"]));
		view.flushSync(() => runtime.updateAttrs("a", { name: "A2" }));

		expect(created).toBe(3);
		expect(view.texts().sort()).toEqual(["A2", "B", "C"]);
		view.unmount();
	});
});
