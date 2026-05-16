import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { ClipItem } from "./ClipItem";

const mockState = vi.hoisted(() => ({
	dispatch: vi.fn(),
	sessionDispatch: vi.fn(),
	attrsByNode: new Map<string, Record<string, unknown>>(),
	relsByNode: new Map<string, Record<string, Array<{ kind: "scope"; _nodeId: string }>>>(),
}));

vi.mock("../../dkt-react-sync/hooks/useActions", () => ({
	useActions: () => mockState.dispatch,
}));

vi.mock("../../dkt-react-sync/hooks/useRootDispatch", () => ({
	useRootDispatch: () => mockState.sessionDispatch,
}));

vi.mock("../../dkt-react-sync/hooks/useAttrs", async () => {
	const React = await import("react");
	const { ScopeContext } = await import(
		"../../dkt-react-sync/context/ScopeContext"
	);
	return {
		useAttrs: (fields: readonly string[]) => {
			const scope = React.useContext(ScopeContext);
			const source =
				(scope?._nodeId
					? mockState.attrsByNode.get(scope._nodeId)
					: undefined) ?? {};
			return Object.fromEntries(
				fields.map((field) => [field, source[field]]),
			);
		},
	};
});

vi.mock("../../dkt-react-sync/hooks/useMany", async () => {
	const React = await import("react");
	const { ScopeContext } = await import(
		"../../dkt-react-sync/context/ScopeContext"
	);
	return {
		useMany: (rel: string) => {
			const scope = React.useContext(ScopeContext);
			if (!scope?._nodeId) {
				return [];
			}
			return mockState.relsByNode.get(scope._nodeId)?.[rel] ?? [];
		},
	};
});

describe("ClipItem conflict UX", () => {
	it("opens materialized conflict details and resolves through Clip DKT actions", async () => {
		const clipScope = { kind: "scope" as const, _nodeId: "clip:1" };
		const conflictScope = { kind: "scope" as const, _nodeId: "conflict:1" };
		mockState.dispatch.mockClear();
		mockState.sessionDispatch.mockClear();
		mockState.attrsByNode.clear();
		mockState.relsByNode.clear();
		mockState.attrsByNode.set(clipScope._nodeId, {
			name: "conflicted.webm",
			start: 0,
			in: 0,
			duration: 4,
			opacity: { value: 1 },
			color: "#2563eb",
			"$meta$aggregates$crdt$clipTiming$open_conflicts_count": 1,
		});
		mockState.attrsByNode.set(conflictScope._nodeId, {
			id: "conflict:duration",
			kind: "mvr_alternatives",
			scope: "clipTiming",
			summary: "Duration has concurrent edits",
			decision: { start: 0, in: 0, duration: 3 },
		});
		mockState.relsByNode.set(clipScope._nodeId, {
			effects: [],
			crdtConflicts: [conflictScope],
		});

		render(
			<ScopeContext.Provider value={clipScope}>
				<ClipItem
					timelineZoom={40}
					activeTool="select"
					selectedEntityId={null}
				/>
			</ScopeContext.Provider>,
		);

		await userEvent.click(screen.getByRole("button", { name: "1 open conflict" }));

		expect(mockState.dispatch).toHaveBeenCalledWith("loadConflicts", {
			scope: { aggregate: "clipTiming" },
		});
		await waitFor(() =>
			expect(screen.getByText("Duration has concurrent edits")).toBeInTheDocument(),
		);

		await userEvent.click(screen.getByRole("button", { name: "Resolve timing" }));

		expect(mockState.dispatch).toHaveBeenCalledWith("resolveClipTimingConflict", {
			conflict_id: "conflict:duration",
			start: 0,
			in: 0,
			duration: 3,
		});
	});
});
