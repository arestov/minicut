import { describe, expect, it } from "vitest";
import {
	normalizeRightSplitClipAttrs,
	removeClipRef,
	reduceSetTrackPreviewEnabled,
} from "./actions";

const modelRef = (_node_id: string) => ({ _node_id });

describe("Track model actions", () => {
	it("removes clip refs by DKT node id", () => {
		expect(
			removeClipRef(
				[modelRef("clip:left"), modelRef("clip:right")],
				"clip:left",
			),
		).toEqual([modelRef("clip:right")]);
		expect(removeClipRef([modelRef("clip:left")], "clip:missing")).toBeNull();
	});

	it("creates right split clip attrs from source clip bounds", () => {
		expect(
			normalizeRightSplitClipAttrs({
				name: "Right",
				sourceClip: { start: 1, in: 2, duration: 5 },
				splitTime: 3,
			}),
		).toMatchObject({
			start: 3,
			in: 4,
			duration: 3,
		});
		expect(
			normalizeRightSplitClipAttrs({
				sourceClip: { start: 1, in: 2, duration: 5 },
				splitTime: 8,
			}),
		).toBeNull();
	});

	it("updates enabled and visibleInPreview together", () => {
		expect(reduceSetTrackPreviewEnabled({ enabled: false })).toEqual({
			enabled: false,
			visibleInPreview: false,
		});
		expect(reduceSetTrackPreviewEnabled(true)).toEqual({
			enabled: true,
			visibleInPreview: true,
		});
	});
});
