import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
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

const seedClip = (
	clipScope: { kind: "scope"; _nodeId: string },
	attrs: Record<string, unknown> = {},
) => {
	mockState.dispatch.mockClear();
	mockState.sessionDispatch.mockClear();
	mockState.attrsByNode.clear();
	mockState.relsByNode.clear();
	mockState.attrsByNode.set(clipScope._nodeId, {
		name: "clip.webm",
		start: 1,
		in: 0,
		duration: 4,
		opacity: { value: 1 },
		color: "#2563eb",
		...attrs,
	});
	mockState.relsByNode.set(clipScope._nodeId, {
		effects: [],
	});
};

describe("ClipItem conflict UX", () => {
	it("dispatches clip timing drag preview and final actions with one intent batch", () => {
		const clipScope = { kind: "scope" as const, _nodeId: "clip:drag" };
		seedClip(clipScope, { name: "drag.webm" });

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

	it("does not expose the legacy clip-level conflict popover from CRDT meta", () => {
		const clipScope = { kind: "scope" as const, _nodeId: "clip:conflict-meta" };
		seedClip(clipScope, {
			"$meta$aggregates$crdt$clipTiming$open_conflicts_count": 1,
			"$meta$aggregates$crdt$clipTiming$last_conflict_id": "conflict:duration",
		});

		renderClipItem(clipScope);

		expect(
			screen.queryByRole("button", { name: /open conflict/i }),
		).not.toBeInTheDocument();
		expect(document.querySelector(".ve-clip-conflict-popover")).toBeNull();
	});
});
