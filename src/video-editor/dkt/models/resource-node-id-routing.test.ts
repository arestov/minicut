import { describe, expect, it } from "vitest";
import { expectProjectGraphInvariants } from "../test/projectGraphAssertions";
import {
	createActionContractHarness,
	dispatchAndSettle,
	readNodeIds,
} from "./action-contract-test-harness";

describe("resource node-id routing", () => {
	it("Project.addResourceToTimeline routes image and audio resources by DKT node id only", async () => {
		const imageHarness = await createActionContractHarness();
		const beforeVideoClipIds = await readNodeIds(
			imageHarness.ctx,
			imageHarness.videoTrack,
			"clips",
		);

		await dispatchAndSettle(
			imageHarness.ctx,
			imageHarness.project,
			"addResourceToTimeline",
			String(imageHarness.imageResource._node_id),
		);

		const afterVideoClipIds = await readNodeIds(
			imageHarness.ctx,
			imageHarness.videoTrack,
			"clips",
		);
		expect(afterVideoClipIds.length).toBe(beforeVideoClipIds.length + 1);
		const videoClips = await imageHarness.ctx.queryRel(
			imageHarness.videoTrack,
			"clips",
		);
		const imageClip = videoClips.find(
			(clip) => !beforeVideoClipIds.includes(String(clip._node_id)),
		);
		expect(
			(await imageHarness.ctx.queryRel(imageClip!, "resource"))[0]?._node_id,
		).toBe(imageHarness.imageResource._node_id);
		await expectProjectGraphInvariants(imageHarness.ctx);

		const audioHarness = await createActionContractHarness();
		const beforeAudioClipIds = await readNodeIds(
			audioHarness.ctx,
			audioHarness.audioTrack,
			"clips",
		);
		expect(audioHarness.ctx.getAttr(audioHarness.audioResource, "kind")).toBe(
			"audio",
		);

		await dispatchAndSettle(
			audioHarness.ctx,
			audioHarness.project,
			"addResourceToTimeline",
			String(audioHarness.audioResource._node_id),
		);

		const afterAudioClipIds = await readNodeIds(
			audioHarness.ctx,
			audioHarness.audioTrack,
			"clips",
		);
		expect(afterAudioClipIds.length).toBe(beforeAudioClipIds.length + 1);

		const audioClips = await audioHarness.ctx.queryRel(
			audioHarness.audioTrack,
			"clips",
		);
		const audioClip = audioClips.find(
			(clip) => !beforeAudioClipIds.includes(String(clip._node_id)),
		);
		expect(
			(await audioHarness.ctx.queryRel(audioClip!, "resource"))[0]?._node_id,
		).toBe(audioHarness.audioResource._node_id);
		await expectProjectGraphInvariants(audioHarness.ctx);
	});
});
