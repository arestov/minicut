import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { ReactScopeRuntimeContext } from "../../dkt-react-sync/context/ReactScopeRuntimeContext";
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

vi.mock("../../dkt-react-sync/hooks/useOne", async () => {
	const React = await import("react");
	const { ScopeContext } = await import(
		"../../dkt-react-sync/context/ScopeContext"
	);
	return {
		useOne: (rel: string) => {
			const scope = React.useContext(ScopeContext);
			if (!scope?._nodeId) {
				return null;
			}
			return mockState.relsByNode.get(scope._nodeId)?.[rel]?.[0] ?? null;
		},
	};
});

vi.mock("../../dkt-react-sync/hooks/useShape", () => ({
	useShape: () => undefined,
}));

const testRuntime = {
	subscribeAttrs: vi.fn(() => () => undefined),
	readAttrs: (scope: { _nodeId?: string }, fields: readonly string[]) => {
		const source = scope?._nodeId
			? mockState.attrsByNode.get(scope._nodeId)
			: undefined;
		return Object.fromEntries(
			fields.map((field) => [field, source?.[field]]),
		);
	},
};

const renderClipItem = (clipScope: { kind: "scope"; _nodeId: string }) =>
	render(
		<ReactScopeRuntimeContext.Provider value={testRuntime as never}>
			<ScopeContext.Provider value={clipScope}>
				<ClipItem
					timelineZoom={40}
					activeTool="select"
					selectedEntityId={null}
				/>
			</ScopeContext.Provider>
		</ReactScopeRuntimeContext.Provider>,
	);

describe("ClipItem conflict UX", () => {
	it("dispatches clip timing drag preview and final actions with one intent batch", () => {
		const clipScope = { kind: "scope" as const, _nodeId: "clip:drag" };
		mockState.dispatch.mockClear();
		mockState.sessionDispatch.mockClear();
		mockState.attrsByNode.clear();
		mockState.relsByNode.clear();
		mockState.attrsByNode.set(clipScope._nodeId, {
			name: "drag.webm",
			start: 1,
			in: 0,
			duration: 4,
			opacity: { value: 1 },
			color: "#2563eb",
		});
		mockState.relsByNode.set(clipScope._nodeId, {
			effects: [],
			crdtConflicts: [],
		});

		renderClipItem(clipScope);

		const clip = screen.getByRole("button", { name: /drag\.webm/i });
		fireEvent.pointerDown(clip, {
			clientX: 40,
			pointerId: 1,
			buttons: 1,
		});
		fireEvent.pointerMove(clip, {
			clientX: 80,
			pointerId: 1,
			buttons: 1,
		});
		fireEvent.pointerUp(clip, {
			clientX: 80,
			pointerId: 1,
			buttons: 0,
		});

		const previewCall = mockState.dispatch.mock.calls.find(
			([actionName]) => actionName === "previewMoveBy",
		);
		const commitCall = mockState.dispatch.mock.calls.find(
			([actionName]) => actionName === "commitTimelineAttrs",
		);
		expect(previewCall).toBeTruthy();
		expect(commitCall).toBeTruthy();
		expect(previewCall?.[1]).toEqual({ delta: 1 });
		expect(previewCall?.[2]).toMatchObject({
			intent: { batch_id: expect.stringMatching(/^clip-timing:clip:drag:/) },
		});
		expect(commitCall?.[2]).toEqual(previewCall?.[2]);
	});

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

		renderClipItem(clipScope);

		await userEvent.click(screen.getByRole("button", { name: "1 open conflict" }));

		expect(mockState.dispatch).toHaveBeenCalledWith("loadConflicts", {
			scope: { model: "clip", include_structural: true },
		});
		expect(mockState.sessionDispatch).not.toHaveBeenCalledWith(
			"selectEntity",
			"clip:1",
		);
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

	it("shows the clip badge for structural CRDT meta", async () => {
		const clipScope = { kind: "scope" as const, _nodeId: "clip:structural" };
		mockState.dispatch.mockClear();
		mockState.sessionDispatch.mockClear();
		mockState.attrsByNode.clear();
		mockState.relsByNode.clear();
		mockState.attrsByNode.set(clipScope._nodeId, {
			name: "structural.webm",
			start: 0,
			in: 0,
			duration: 4,
			opacity: { value: 1 },
			color: "#2563eb",
			"$meta$aggregates$crdt$timelineMembership$open_conflicts_count": 1,
		});
		mockState.relsByNode.set(clipScope._nodeId, {
			effects: [],
			crdtConflicts: [],
		});

		renderClipItem(clipScope);

		await userEvent.click(screen.getByRole("button", { name: "1 open conflict" }));

		expect(mockState.dispatch).toHaveBeenCalledWith("loadConflicts", {
			scope: { model: "clip", include_structural: true },
		});
		expect(screen.getByText("No open conflicts")).toBeInTheDocument();
	});

	it("renders structural conflict projection actions from materialized conflicts", async () => {
		const clipScope = { kind: "scope" as const, _nodeId: "clip:structural-actions" };
		const conflictScope = { kind: "scope" as const, _nodeId: "conflict:structural" };
		mockState.dispatch.mockClear();
		mockState.sessionDispatch.mockClear();
		mockState.attrsByNode.clear();
		mockState.relsByNode.clear();
		mockState.attrsByNode.set(clipScope._nodeId, {
			name: "structural-actions.webm",
			start: 0,
			in: 0,
			duration: 4,
			opacity: { value: 1 },
			color: "#2563eb",
			"$meta$model$crdt$open_conflicts_count": 1,
		});
		mockState.attrsByNode.set(conflictScope._nodeId, {
			id: "structural:delete:clip-1",
			kind: "structural_delete_with_concurrent_activity",
			scope: "timelineMembership",
			summary: "Remote delete conflicts with local effect edit",
		});
		mockState.relsByNode.set(clipScope._nodeId, {
			effects: [],
			crdtConflicts: [conflictScope],
		});

		renderClipItem(clipScope);

		await userEvent.click(screen.getByRole("button", { name: "1 open conflict" }));
		await waitFor(() =>
			expect(screen.getByText("Remote delete conflicts with local effect edit")).toBeInTheDocument(),
		);
		await userEvent.click(screen.getByRole("button", { name: "Keep local" }));

		expect(mockState.dispatch).toHaveBeenCalledWith("resolveStructuralConflict", {
			conflict_id: "structural:delete:clip-1",
			decision: { type: "keep_local" },
		});
	});
});
