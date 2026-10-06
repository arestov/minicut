import { afterEach, describe, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { Many, RootScope } from "../../../dkt-solid-sync";
import {
	createSkeletonRaceFixture,
	type SkeletonRaceFixture,
} from "../fixtures/skeletonRace";
import { TrackRow } from "./TrackRow";
import { TimelineViewContext, type TimelineView } from "./timelineView";

let fixture: SkeletonRaceFixture | null = null;

afterEach(() => {
	fixture?.destroy();
	fixture = null;
});

const view: TimelineView = {
	zoom: () => 50,
	scrollX: () => 0,
	viewportWidth: () => 1000,
	selectedEntityId: () => null,
};

const mount = () => {
	const current = createSkeletonRaceFixture(["track-v1"]);
	fixture = current;
	const root = createTestRoot();
	root.render(() => (
		<div style={{ display: "flex", flexDirection: "column", width: 800, height: 200 }}>
			<RootScope runtime={current.runtime}>
				<TimelineViewContext.Provider value={view}>
					<Many rel="tracks" item={TrackRow} readyAttr="kind" />
				</TimelineViewContext.Provider>
			</RootScope>
		</div>
	));
	return { current, root, clips: () => root.renderer.findByType("div").filter((e) => e.testId === "clip").length };
};

describe("timeline against the skeleton race", () => {
	test("a track row waits for its attrs and a clip waits for its timing attrs", () => {
		const { current, root, clips } = mount();

		// The rel is in, the track has no attrs yet: no row at all.
		expect(root.renderer.findByType("div").some((e) => e.testId === "track-row")).toBe(false);

		root.flushSync(() => current.deliverTrackAttrs("track-v1", { name: "V1", kind: "video" }));
		expect(root.renderer.getAllText()).toContain("V1");
		expect(clips()).toBe(0);

		// The clips rel arrives before any clip attr: still nothing placed.
		root.flushSync(() => current.deliverClipsRel("track-v1", ["clip-1"]));
		expect(clips()).toBe(0);

		// A name alone does not place it either; without a start it would sit at 0.
		root.flushSync(() => current.deliverAttrs("clip-1", { name: "Early" }));
		expect(clips()).toBe(0);

		root.flushSync(() => current.deliverAttrs("clip-1", { start: 3, duration: 2 }));
		expect(clips()).toBe(1);
		expect(root.renderer.getAllText()).toContain("Early");
		root.unmount();
	});
});
