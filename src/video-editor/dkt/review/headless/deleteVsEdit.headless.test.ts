import { describe, expect, it } from "vitest";
import {
	buildDeleteVsEditArchivePayload,
	buildDeleteVsEditParkPayload,
	buildDeleteVsEditRestorePayload,
} from "../../../components/review/reviewActionPayloads";
import type { DeleteVsEditPreview } from "../features/deleteVsEdit";
import type { MiniCutReviewItem } from "../types";
import {
	dispatchReviewActionLikeUi,
	findModelByNodeId,
} from "./dispatchReviewActionLikeUi";
import type { HeadlessDktModel, HeadlessReviewPeer } from "./createHeadlessReviewPair";
import { createNaturalDeleteVsEditConflict } from "./naturalConflictGenerators";
import { expectConflictStoreResolvedOnBoth } from "./reviewAssertions";

const deleteVsEditPreview = (item: {
	preview: unknown;
}): DeleteVsEditPreview => {
	const preview = item.preview as DeleteVsEditPreview;
	expect(preview.type).toBe("delete_vs_edit");
	expect(preview.deletedVariant.clipId).toBeTruthy();
	expect(preview.restoreTarget?.trackId).toBeTruthy();
	expect(Object.keys(preview.editedVariant.clipAttrs).length).toBeGreaterThan(0);
	return preview;
};

const readTrackById = async (
	peer: HeadlessReviewPeer,
	project: HeadlessDktModel,
	trackId: string,
): Promise<HeadlessDktModel> => {
	const tracks = (await peer.ctx.queryRel(
		project,
		"tracks",
	)) as HeadlessDktModel[];
	const track = tracks.find((entry) => entry._node_id === trackId);
	if (!track) {
		throw new Error(`Expected track ${trackId}`);
	}
	return track;
};

const readTrackClips = async (
	peer: HeadlessReviewPeer,
	project: HeadlessDktModel,
	trackId: string,
): Promise<HeadlessDktModel[]> =>
	(await peer.ctx.queryRel(await readTrackById(peer, project, trackId), "clips")) as
		HeadlessDktModel[];

const flushPair = async (pair: {
	a: HeadlessReviewPeer;
	b: HeadlessReviewPeer;
	waitForConvergence: () => Promise<void>;
}) => {
	await pair.waitForConvergence();
	await new Promise<void>((resolve) => pair.a.ctx.runtime.whenAllReady?.(resolve));
	await new Promise<void>((resolve) => pair.b.ctx.runtime.whenAllReady?.(resolve));
};

const readIncomingReviewClips = async (
	peer: HeadlessReviewPeer,
): Promise<HeadlessDktModel[]> => {
	const tracks = (await peer.ctx.queryRel(
		peer.ctx.appModel,
		"track",
	)) as HeadlessDktModel[];
	for (const track of tracks) {
		if ((await attr(peer, track, "trackRole")) === "incomingReview") {
			return (await peer.ctx.queryRel(track, "clips")) as HeadlessDktModel[];
		}
	}
	throw new Error("Expected incoming review track");
};

const attr = (peer: HeadlessReviewPeer, model: HeadlessDktModel, name: string) =>
	peer.ctx.queryAttr(model, name);

const expectClipAttrs = async (
	peer: HeadlessReviewPeer,
	clip: HeadlessDktModel,
	clipAttrs: Record<string, unknown>,
) => {
	for (const key of ["name", "mediaKind", "start", "in", "duration"]) {
		if (clipAttrs[key] !== undefined) {
			expect(await attr(peer, clip, key)).toEqual(clipAttrs[key]);
		}
	}
};

const actionProject = async (
	peer: HeadlessReviewPeer,
	item: MiniCutReviewItem,
) => {
	const target = item.actionTargets.resolveDeleteVsEditByRestoreVariant;
	if (!target || target.type !== "project") {
		throw new Error("Expected project action target");
	}
	const project = await findModelByNodeId(peer, target);
	if (!project) {
		throw new Error(`Expected project ${target.id}`);
	}
	return project;
};

describe("headless delete-vs-edit review actions", () => {
	it("restores the edited variant from a natural delete-vs-edit review item", async () => {
		const { pair, item } = await createNaturalDeleteVsEditConflict(
			"room-headless-delete-vs-edit-restore",
		);
		try {
			const preview = deleteVsEditPreview(item);
			const trackId = preview.restoreTarget?.trackId ?? "";

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveDeleteVsEditByRestoreVariant",
				buildDeleteVsEditRestorePayload(item),
			);

			await flushPair(pair);
			await expectConflictStoreResolvedOnBoth(pair, item.conflictId);
			const project = await actionProject(pair.a, item);
			const clips = await readTrackClips(pair.a, project, trackId);
			const restored = clips.find(
				(clip) => clip._node_id !== preview.deletedVariant.clipId,
			);
			expect(restored?._node_id).toBeTruthy();
			await expectClipAttrs(pair.a, restored as HeadlessDktModel, preview.editedVariant.clipAttrs);
		} finally {
			pair.close();
		}
	});

	it("parks the edited variant on an incoming review track", async () => {
		const { pair, item } = await createNaturalDeleteVsEditConflict(
			"room-headless-delete-vs-edit-park",
		);
		try {
			const preview = deleteVsEditPreview(item);

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"parkEditedVariantOnReviewTrack",
				buildDeleteVsEditParkPayload(item),
			);

			await flushPair(pair);
			await expectConflictStoreResolvedOnBoth(pair, item.conflictId);
			const clips = await readIncomingReviewClips(pair.a);
			const parked = clips.find(
				(clip) => clip._node_id !== preview.deletedVariant.clipId,
			);
			expect(parked?._node_id).toBeTruthy();
			await expectClipAttrs(pair.a, parked as HeadlessDktModel, {
				...preview.editedVariant.clipAttrs,
				name: `${String(preview.editedVariant.clipAttrs.name)} edited variant`,
			});
		} finally {
			pair.close();
		}
	});

	it("preserves delete and archives the incoming edit locally", async () => {
		const { pair, item } = await createNaturalDeleteVsEditConflict(
			"room-headless-delete-vs-edit-archive",
		);
		try {
			const preview = deleteVsEditPreview(item);

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"preserveDeleteAndArchiveIncomingEdit",
				buildDeleteVsEditArchivePayload(item),
			);

			await flushPair(pair);
			await expectConflictStoreResolvedOnBoth(pair, item.conflictId);
			const project = await actionProject(pair.a, item);
			const archiveEntries = (await pair.a.ctx.queryRel(
				project,
				"reviewArchiveEntries",
			)) as HeadlessDktModel[];
			let archived: HeadlessDktModel | undefined;
			for (const entry of archiveEntries) {
				if ((await attr(pair.a, entry, "conflictId")) === item.conflictId) {
					archived = entry;
					break;
				}
			}
			expect(archived?._node_id).toBeTruthy();
			expect(await attr(pair.a, archived as HeadlessDktModel, "sourceConflictClipId")).toBe(
				preview.deletedVariant.clipId,
			);
		} finally {
			pair.close();
		}
	});
});
