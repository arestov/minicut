import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactScopeRuntime } from "../runtime/ReactScopeRuntime";
import { RootScope } from "../scope/RootScope";
import type { ReactSyncScopeHandle } from "../scope/ScopeHandle";
import { createTestReactScopeRuntime } from "../test/createTestReactScopeRuntime";
import { useAttrs } from "./useAttrs";

const createScope = (nodeId: string): ReactSyncScopeHandle => ({
	kind: "scope",
	_nodeId: nodeId,
});

const createRuntime = (
	attrsByNodeId: Record<string, Record<string, unknown>>,
): ReactScopeRuntime & {
	updateAttrs(nodeId: string, patch: Record<string, unknown>): void;
} => {
	const rootScope = createScope("root");
	const rootListeners = new Set<() => void>();
	const attrListenersByNodeId = new Map<string, Set<() => void>>();
	const attrsCache = new Map<string, Record<string, unknown>>();

	const readCachedAttrs = (
		scope: ReactSyncScopeHandle,
		attrNames: readonly string[],
	) => {
		const cacheKey = `${scope._nodeId}\u001f${attrNames.join("\u001f")}`;
		const attrs = attrsByNodeId[scope._nodeId] ?? {};
		const nextSnapshot = Object.fromEntries(
			attrNames.map((attrName) => [attrName, attrs[attrName]]),
		);
		const cached = attrsCache.get(cacheKey);

		if (
			cached &&
			attrNames.every((attrName) =>
				Object.is(cached[attrName], nextSnapshot[attrName]),
			)
		) {
			return cached;
		}

		attrsCache.set(cacheKey, nextSnapshot);
		return nextSnapshot;
	};

	const notifyAttrs = (nodeId: string) => {
		for (const listener of attrListenersByNodeId.get(nodeId) ?? []) {
			listener();
		}
	};

	return {
		getRootScope() {
			return rootScope;
		},
		subscribeRootScope(listener: () => void) {
			rootListeners.add(listener);
			return () => rootListeners.delete(listener);
		},
		readAttrs(scope, attrNames) {
			return readCachedAttrs(scope, attrNames);
		},
		subscribeAttrs(scope, _attrNames, listener) {
			const listeners =
				attrListenersByNodeId.get(scope._nodeId) ?? new Set<() => void>();
			listeners.add(listener);
			attrListenersByNodeId.set(scope._nodeId, listeners);
			return () => listeners.delete(listener);
		},
		readOne() {
			return null;
		},
		subscribeOne() {
			return () => {};
		},
		readMany() {
			return [];
		},
		subscribeMany() {
			return () => {};
		},
		mountShape() {
			return () => {};
		},
		dispatch() {},
		getDispatch() {
			return () => {};
		},
		updateAttrs(nodeId: string, patch: Record<string, unknown>) {
			attrsByNodeId[nodeId] = {
				...(attrsByNodeId[nodeId] ?? {}),
				...patch,
			};
			for (const cacheKey of attrsCache.keys()) {
				if (cacheKey.startsWith(`${nodeId}\u001f`)) {
					attrsCache.delete(cacheKey);
				}
			}
			notifyAttrs(nodeId);
		},
	};
};

describe("useAttrs", () => {
	it("subscribes to attrs from the current scope and rerenders on updates", () => {
		const runtime = createRuntime({
			root: {
				name: "Clip A",
				status: "ready",
			},
		});
		const mountedShapes: string[] = [];
		vi.spyOn(runtime, "mountShape").mockImplementation((_scope, shape) => {
			mountedShapes.push(shape.id);
			return () => {};
		});

		const Probe = () => {
			const attrs = useAttrs(["status", "name"]);
			return <div>{`${String(attrs.name)}:${String(attrs.status)}`}</div>;
		};

		render(
			<RootScope runtime={runtime}>
				<Probe />
			</RootScope>,
		);

		expect(screen.getByText("Clip A:ready")).toBeInTheDocument();
		expect(mountedShapes).toHaveLength(1);

		act(() => {
			runtime.updateAttrs("root", { status: "loading" });
		});

		expect(screen.getByText("Clip A:loading")).toBeInTheDocument();
	});

	it("keeps the same snapshot object when attrs are unchanged across parent renders", () => {
		const runtime = createTestReactScopeRuntime({
			attrsByNodeId: {
				root: { name: "Stable" },
			},
		});
		const snapshots: Array<Record<string, unknown>> = [];

		const Probe = () => {
			const attrs = useAttrs(["name"]);
			snapshots.push(attrs);
			return <div>{String(attrs.name)}</div>;
		};

		const { rerender } = render(
			<RootScope runtime={runtime}>
				<Probe />
			</RootScope>,
		);

		rerender(
			<RootScope runtime={runtime}>
				<Probe />
			</RootScope>,
		);

		expect(screen.getByText("Stable")).toBeInTheDocument();
		expect(snapshots).toHaveLength(2);
		expect(snapshots[1]).toBe(snapshots[0]);
	});
});
