import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useActions } from "../hooks/useActions";
import { useAttrs } from "../hooks/useAttrs";
import type { ReactScopeRuntime } from "../runtime/ReactScopeRuntime";
import { RootScope } from "../scope/RootScope";
import type { ReactSyncScopeHandle } from "../scope/ScopeHandle";
import { Path } from "./Path";

const createScope = (nodeId: string): ReactSyncScopeHandle => ({
	kind: "scope",
	_nodeId: nodeId,
});

describe("Path", () => {
	it("walks nested rels and dispatches actions in the resolved leaf scope", () => {
		const rootScope = createScope("root");
		const sessionScope = createScope("session");
		const projectScope = createScope("project");
		const dispatch = vi.fn();
		const attrsCache = new Map<string, Record<string, unknown>>();

		const readCachedAttrs = (
			scope: ReactSyncScopeHandle,
			attrNames: readonly string[],
		) => {
			const attrsByNodeId: Record<string, Record<string, unknown>> = {
				project: { name: "Project A" },
			};
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

		const runtime: ReactScopeRuntime = {
			getRootScope() {
				return rootScope;
			},
			subscribeRootScope() {
				return () => {};
			},
			readAttrs(scope, attrNames) {
				return readCachedAttrs(scope, attrNames);
			},
			subscribeAttrs() {
				return () => {};
			},
			readOne(scope, relName) {
				if (scope._nodeId === "root" && relName === "session") {
					return sessionScope;
				}
				if (scope._nodeId === "session" && relName === "activeProject") {
					return projectScope;
				}
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
			dispatch(actionName, payload, scope) {
				dispatch({ actionName, payload, scopeNodeId: scope?._nodeId ?? null });
			},
			getDispatch(scope) {
				return (actionName: string, payload?: unknown) =>
					this.dispatch(actionName, payload, scope);
			},
		};

		const Leaf = () => {
			const attrs = useAttrs(["name"]);
			const scopedDispatch = useActions();

			return (
				<button
					type="button"
					onClick={() => scopedDispatch("rename", { name: "Project B" })}
				>
					{String(attrs.name)}
				</button>
			);
		};

		render(
			<RootScope runtime={runtime}>
				<Path rels={["session", "activeProject"]}>
					<Leaf />
				</Path>
			</RootScope>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Project A" }));

		expect(dispatch).toHaveBeenCalledWith({
			actionName: "rename",
			payload: { name: "Project B" },
			scopeNodeId: "project",
		});
	});
});
