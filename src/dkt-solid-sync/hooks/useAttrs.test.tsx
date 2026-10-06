import { describe, expect, test } from "bun:test";
import { createTestReactScopeRuntime } from "../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { renderInRootScope } from "../test/renderSolid";
import { useAttrs } from "./useAttrs";

describe("useAttrs", () => {
	test("subscribes only to requested attrs and updates on change", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { root: { name: "Clip A", status: "ready", other: 1 } },
		});

		const Probe = () => {
			const attrs = useAttrs(["status", "name"]);
			return <text>{`${String(attrs.name())}:${String(attrs.status())}`}</text>;
		};

		const view = renderInRootScope(runtime, () => <Probe />);

		expect(view.texts()).toEqual(["Clip A:ready"]);
		expect(runtime.attrSubscriptions).toEqual([
			{ scopeNodeId: "root", attrNames: ["name", "status"], active: true },
		]);
		expect(runtime.shapeMounts.map((m) => m.attrs)).toEqual([
			["name", "status"],
		]);

		view.flushSync(() => runtime.updateAttrs("root", { status: "loading" }));

		expect(view.texts()).toEqual(["Clip A:loading"]);
		view.unmount();
	});

	test("unsubscribes and releases shape demand on unmount", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { root: { name: "Clip A" } },
		});

		const Probe = () => {
			const attrs = useAttrs(["name"]);
			return <text>{String(attrs.name())}</text>;
		};

		const view = renderInRootScope(runtime, () => <Probe />);

		expect(runtime.attrSubscriptions.map((s) => s.active)).toEqual([true]);
		expect(runtime.shapeMounts.map((m) => m.released)).toEqual([false]);

		view.unmount();

		expect(runtime.attrSubscriptions.map((s) => s.active)).toEqual([false]);
		expect(runtime.shapeMounts.map((m) => m.released)).toEqual([true]);
	});

	test("only the signal of a changed attr notifies", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: { root: { a: 1, b: 1 } },
		});
		const reads = { a: 0, b: 0 };

		const Probe = () => {
			const attrs = useAttrs(["a", "b"]);
			return (
				<text>
					{(() => {
						reads.a += 1;
						return `a${String(attrs.a())}`;
					})()}
				</text>
			);
		};

		const view = renderInRootScope(runtime, () => <Probe />);

		view.flushSync(() => runtime.updateAttrs("root", { b: 2 }));
		expect(reads.a).toBe(1);

		view.flushSync(() => runtime.updateAttrs("root", { a: 2 }));
		expect(reads.a).toBe(2);
		expect(view.texts()).toEqual(["a2"]);
		view.unmount();
	});
});
