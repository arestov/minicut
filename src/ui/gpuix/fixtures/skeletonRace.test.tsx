import { afterEach, describe, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { Many, RootScope, useAttrs } from "../../../dkt-solid-sync";
import {
	createSkeletonRaceFixture,
	type SkeletonRaceFixture,
} from "./skeletonRace";

let fixture: SkeletonRaceFixture | null = null;

afterEach(() => {
	fixture?.destroy();
	fixture = null;
});

const TrackRow = () => {
	const attrs = useAttrs(["name", "kind"]);
	return (
		<text>{`${String(attrs.kind())}:${String(attrs.name())}`}</text>
	);
};

const mountTracks = (guarded: boolean) => {
	const current = createSkeletonRaceFixture();
	fixture = current;
	const root = createTestRoot();
	root.render(() => (
		<div>
			<RootScope runtime={current.runtime}>
				{guarded ? (
					<Many rel="tracks" item={TrackRow} readyAttr="name" />
				) : (
					<Many rel="tracks" item={TrackRow} />
				)}
			</RootScope>
		</div>
	));
	return { current, root, texts: () => root.renderer.getAllText() };
};

describe("skeleton race fixture", () => {
	test("delivers the rel before any track attrs", () => {
		const current = createSkeletonRaceFixture();
		fixture = current;
		const rootScope = current.runtime.getRootScope();
		if (!rootScope) {
			throw new Error("Expected root scope");
		}

		expect(current.runtime.readAttrs(rootScope, ["title"]).title).toBe(
			"Skeleton project",
		);
		const tracks = current.runtime.readMany(rootScope, "tracks");
		expect(tracks.map((scope) => scope._nodeId)).toEqual([
			"track-v1",
			"track-a1",
		]);
		expect(current.runtime.readAttrs(tracks[0], ["name"]).name).toBeUndefined();
	});

	test("an unguarded row renders the half-arrived skeleton", () => {
		const { texts, root } = mountTracks(false);

		expect(texts()).toEqual(["undefined:undefined", "undefined:undefined"]);
		root.unmount();
	});

	test("readyAttr withholds rows until their attrs arrive", () => {
		const { current, root, texts } = mountTracks(true);

		expect(texts()).toEqual([]);

		root.flushSync(() =>
			current.deliverTrackAttrs("track-a1", { name: "A1", kind: "audio" }),
		);
		expect(texts()).toEqual(["audio:A1"]);

		root.flushSync(() =>
			current.deliverTrackAttrs("track-v1", { name: "V1", kind: "video" }),
		);
		expect(texts()).toEqual(["video:V1", "audio:A1"]);
		root.unmount();
	});

	test("rows appear together when all attrs arrive in one update", () => {
		const { current, root, texts } = mountTracks(true);

		root.flushSync(() =>
			current.deliverAllTrackAttrs({
				"track-v1": { name: "V1", kind: "video" },
				"track-a1": { name: "A1", kind: "audio" },
			}),
		);

		expect(texts()).toEqual(["video:V1", "audio:A1"]);
		root.unmount();
	});
});
