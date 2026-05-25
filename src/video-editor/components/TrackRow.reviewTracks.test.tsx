import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { TrackLabel } from "./TrackRow";

const mockState = vi.hoisted(() => ({
	dispatch: vi.fn(),
	attrs: {} as Record<string, unknown>,
}));

vi.mock("../../dkt-react-sync/hooks/useActions", () => ({
	useActions: () => mockState.dispatch,
}));

vi.mock("../../dkt-react-sync/hooks/useAttrs", () => ({
	useAttrs: (fields: readonly string[]) =>
		Object.fromEntries(fields.map((field) => [field, mockState.attrs[field]])),
}));

describe("TrackRow review tracks", () => {
	beforeEach(() => {
		mockState.dispatch.mockReset();
		mockState.attrs = {
			name: "Incoming Review",
			kind: "video",
			muted: true,
			locked: false,
			enabled: false,
			visibleInPreview: false,
			trackRole: "incomingReview",
		};
	});

	it("shows review role and disabled preview state", () => {
		render(
			<ScopeContext.Provider
				value={{ kind: "scope", _nodeId: "track:review" }}
			>
				<TrackLabel />
			</ScopeContext.Provider>,
		);

		expect(screen.getByText("Incoming Review")).toBeInTheDocument();
		expect(screen.getByText(/Preview disabled/)).toBeInTheDocument();
	});

	it("dispatches deterministic preview toggle without changing mute", () => {
		render(
			<ScopeContext.Provider
				value={{ kind: "scope", _nodeId: "track:review" }}
			>
				<TrackLabel />
			</ScopeContext.Provider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Preview disabled" }));

		expect(mockState.dispatch).toHaveBeenCalledWith(
			"setTrackPreviewEnabled",
			{ enabled: true },
		);
	});
});
