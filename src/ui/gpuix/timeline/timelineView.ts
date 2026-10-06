import { type Accessor, createContext, useContext } from "solid-js";

/** View state shared by the timeline rows and clips (not model data). */
export type TimelineView = {
	/** Pixels per second; comes from the session `timelineZoom` attr. */
	zoom: Accessor<number>;
	scrollX: Accessor<number>;
	/** Generous upper bound of the lane width, used only for culling. */
	viewportWidth: Accessor<number>;
	selectedEntityId: Accessor<string | null>;
};

export const TimelineViewContext = createContext<TimelineView>();

export const useTimelineView = (): TimelineView => {
	const view = useContext(TimelineViewContext);
	if (!view) {
		throw new Error("useTimelineView must be used inside Timeline");
	}
	return view;
};

export const HEADER_WIDTH = 140;
export const RULER_HEIGHT = 28;
export const DEFAULT_ROW_HEIGHT = 56;
