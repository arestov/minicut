import { describe, expect, it } from "vitest";
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from "../../models/sessionZoom";
import { expectProjectGraphInvariants } from "../test/projectGraphAssertions";
import {
	createActionContractHarness,
	dispatchAndSettle,
	findByNodeId,
	readNodeIds,
} from "./action-contract-test-harness";

describe("SessionRoot action contracts", () => {
	it("bootstraps exactly one project and does not duplicate on repeated handleInit", async () => {
		const harness = await createActionContractHarness();

		const projectsBefore = await harness.ctx.queryRel(
			harness.ctx.appModel,
			"project",
		);
		expect(projectsBefore.length).toBeGreaterThanOrEqual(1);
		const initialProjectCount = projectsBefore.length;

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "handleInit");

		const projectsAfter = await harness.ctx.queryRel(
			harness.ctx.appModel,
			"project",
		);
		expect(projectsAfter).toHaveLength(initialProjectCount);
		expect(typeof projectsAfter[0]?._node_id).toBe("string");
	});

	it("handleInit repairs active project rel when activeProjectId is already set", async () => {
		const harness = await createActionContractHarness();
		const activeProjectId = String(harness.project._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"syncActiveProjectRel",
			{ project: null },
		);
		expect(
			await harness.ctx.queryRel(harness.sessionRoot, "activeProject"),
		).toHaveLength(0);
		expect(harness.ctx.getAttr(harness.sessionRoot, "activeProjectId")).toBe(
			activeProjectId,
		);

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "handleInit");

		const activeProject = (
			await harness.ctx.queryRel(harness.sessionRoot, "activeProject")
		)[0];
		expect(activeProject?._node_id).toBe(activeProjectId);
	});

	it("createProject switches active project and clears editor state", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "createProject", {
			title: "New Project",
		});

		const activeProject = (
			await harness.ctx.queryRel(harness.sessionRoot, "activeProject")
		)[0];
		expect(activeProject).toBeTruthy();
		if (!activeProject) {
			throw new Error("Expected active project");
		}
		expect(harness.ctx.getAttr(activeProject, "title")).toBe("New Project");
		expect(harness.ctx.getAttr(harness.sessionRoot, "activeProjectId")).toBe(
			activeProject._node_id,
		);
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "selectedEntityId"),
		).toBeNull();
		expect(harness.ctx.getAttr(harness.sessionRoot, "cursor")).toBe(0);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("selectEntity resolves selectedClip and summary from the current graph", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);

		expect(harness.ctx.getAttr(harness.sessionRoot, "selectedEntityId")).toBe(
			selectedClipId,
		);
		const selectedClip = (
			await harness.ctx.queryRel(harness.sessionRoot, "selectedClip")
		)[0];
		expect(selectedClip?._node_id).toBe(selectedClipId);
		const summary = harness.ctx.getAttr(
			harness.sessionRoot,
			"selectedClipSummary",
		) as { resourceName?: string } | null;
		expect(summary?.resourceName).toBe("Video Clip");
	});

	it("setActiveProject resets selection and cursor", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);
		const activeProjectId = String(harness.project._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "setCursor", 3.5);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setActiveProject",
			activeProjectId,
		);

		expect(
			harness.ctx.getAttr(harness.sessionRoot, "selectedEntityId"),
		).toBeNull();
		expect(harness.ctx.getAttr(harness.sessionRoot, "cursor")).toBe(0);
	});

	it("setActiveInspectorTab only accepts valid tabs", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setActiveInspectorTab",
			"audio",
		);
		expect(harness.ctx.getAttr(harness.sessionRoot, "activeInspectorTab")).toBe(
			"audio",
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setActiveInspectorTab",
			"not-a-tab",
		);
		expect(harness.ctx.getAttr(harness.sessionRoot, "activeInspectorTab")).toBe(
			"audio",
		);
	});

	it("setCursor rounds and clamps, and zoom actions obey bounds", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "setCursor", -1);
		expect(harness.ctx.getAttr(harness.sessionRoot, "cursor")).toBe(0);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setCursor",
			1.239,
		);
		expect(harness.ctx.getAttr(harness.sessionRoot, "cursor")).toBe(1.24);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setTimelineZoom",
			1,
		);
		expect(harness.ctx.getAttr(harness.sessionRoot, "timelineZoom")).toBe(
			TIMELINE_ZOOM_MIN,
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"zoomTimeline",
			999,
		);
		expect(harness.ctx.getAttr(harness.sessionRoot, "timelineZoom")).toBe(
			TIMELINE_ZOOM_MAX,
		);
	});

	it("playback actions toggle state and tick when playing", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setPlaying",
			true,
		);
		expect(harness.ctx.getAttr(harness.sessionRoot, "isPlaying")).toBe(true);

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "tickPlayback", {
			deltaSeconds: 0.5,
		});
		expect(harness.ctx.getAttr(harness.sessionRoot, "cursor")).toBe(0.5);

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "togglePlayback");
		expect(harness.ctx.getAttr(harness.sessionRoot, "isPlaying")).toBe(false);
	});

	it("preview buffer actions create, advance, and clear buffer", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"startPreviewBuffer",
		);
		const previewBuffer = harness.ctx.getAttr(
			harness.sessionRoot,
			"previewBuffer",
		) as { startCursor?: number } | null;
		expect(previewBuffer).toBeTruthy();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setPlaying",
			true,
		);
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "tickPlayback", {
			deltaSeconds: 0.5,
		});
		expect(harness.ctx.getAttr(harness.sessionRoot, "cursor")).toBe(0.5);
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "previewBuffer"),
		).toBeTruthy();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"clearPreviewBuffer",
		);
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "previewBuffer"),
		).toBeNull();
	});

	it("addTextClipToTimeline forwards to the project video track and creates text node", async () => {
		const harness = await createActionContractHarness();
		const beforeClipIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		const beforeTextCount = (
			await harness.ctx.queryRel(harness.ctx.appModel, "text")
		).length;

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"addTextClipToTimeline",
			{
				name: "Session Text",
				mediaKind: "text",
				start: 6,
				in: 0,
				duration: 2,
				text: {
					content: "Session text",
				},
			},
		);

		const afterClipIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		expect(afterClipIds.length).toBe(beforeClipIds.length + 1);
		const textModels = await harness.ctx.queryRel(harness.ctx.appModel, "text");
		expect(textModels.length).toBe(beforeTextCount + 1);
		expect(
			textModels.some(
				(text) => harness.ctx.getAttr(text, "content") === "Session text",
			),
		).toBe(true);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("importResourceIntoActiveProject creates a resource on the active project", async () => {
		const harness = await createActionContractHarness();
		const beforeResourceIds = await readNodeIds(
			harness.ctx,
			harness.project,
			"resources",
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"importResourceIntoActiveProject",
			{
				name: "Session Imported Video",
				kind: "video",
				url: "https://example.invalid/session-imported-video.webm",
				mime: "video/webm",
				duration: 5,
				size: 500,
				source: { kind: "local" },
				status: "ready",
				data: { status: "ready" },
			},
		);

		const resources = await harness.ctx.queryRel(harness.project, "resources");
		const createdResource = resources.find(
			(resource) =>
				harness.ctx.getAttr(resource, "name") === "Session Imported Video",
		);
		expect(createdResource?._node_id).toBeTruthy();
		expect(
			await readNodeIds(harness.ctx, harness.project, "resources"),
		).toHaveLength(beforeResourceIds.length + 1);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("active project timeline forwarding creates video and embedded audio clips", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"importResourceIntoActiveProject",
			{
				name: "Session Forwarded Video",
				kind: "video",
				url: "https://example.invalid/session-forwarded-video.webm",
				mime: "video/webm",
				duration: 5,
				size: 500,
				source: { kind: "local" },
				status: "ready",
				data: { status: "ready" },
			},
		);

		const importedResource = (
			await harness.ctx.queryRel(harness.project, "resources")
		).find(
			(resource) =>
				harness.ctx.getAttr(resource, "name") === "Session Forwarded Video",
		);
		expect(importedResource?._node_id).toBeTruthy();

		const beforeVideoClipIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		const beforeAudioClipIds = await readNodeIds(
			harness.ctx,
			harness.audioTrack,
			"clips",
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"addActiveProjectResourceToTimeline",
			String(importedResource._node_id),
		);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"addActiveProjectEmbeddedAudioToTimeline",
			{ resourceId: String(importedResource._node_id) },
		);

		const afterVideoClipIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		const afterAudioClipIds = await readNodeIds(
			harness.ctx,
			harness.audioTrack,
			"clips",
		);
		expect(afterVideoClipIds.length).toBe(beforeVideoClipIds.length + 1);
		expect(afterAudioClipIds.length).toBe(beforeAudioClipIds.length + 1);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("setActiveProjectImportProgress forwards progress to active project", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setActiveProjectImportProgress",
			{
				taskId: "input-batch:session-progress",
				stage: "processing",
				processed: 1,
				total: 2,
			},
		);

		expect(harness.ctx.getAttr(harness.project, "activeImportTaskId")).toBe(
			"input-batch:session-progress",
		);
		expect(harness.ctx.getAttr(harness.project, "importProgress")).toEqual({
			stage: "processing",
			processed: 1,
			total: 2,
		});
	});

	it("nudgeSelectedClip moves the selected clip by the requested delta", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"nudgeSelectedClip",
			{ delta: 0.5 },
		);

		expect(harness.ctx.getAttr(harness.videoClip, "start")).toBe(1.5);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("nudgeSelectedClip ignores invalid deltas and missing selections", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"nudgeSelectedClip",
			{ delta: 0.5 },
		);
		expect(harness.ctx.getAttr(harness.videoClip, "start")).toBe(1);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"nudgeSelectedClip",
			{ delta: Number.NaN },
		);
		expect(harness.ctx.getAttr(harness.videoClip, "start")).toBe(1);
	});

	it("splitSelectedClip creates exactly one right clip with resource and track invariants", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);
		const beforeNodeIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "setCursor", 3);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"splitSelectedClip",
		);

		const afterNodeIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		const rightNodeIds = afterNodeIds.filter(
			(id) => !beforeNodeIds.includes(id),
		);
		expect(afterNodeIds.length).toBe(beforeNodeIds.length + 1);
		expect(rightNodeIds).toHaveLength(1);
		expect(harness.ctx.getAttr(harness.videoClip, "start")).toBe(1);
		expect(harness.ctx.getAttr(harness.videoClip, "duration")).toBe(2);

		const rightClip = await findByNodeId(
			harness.ctx,
			harness.videoTrack,
			"clips",
			rightNodeIds[0],
		);
		expect(rightClip).toBeTruthy();
		if (!rightClip) {
			throw new Error("Expected right clip");
		}
		expect(harness.ctx.getAttr(rightClip, "start")).toBe(3);
		expect(harness.ctx.getAttr(rightClip, "duration")).toBe(2);
		expect(harness.ctx.getAttr(rightClip, "in")).toBe(2);
		const rightClipResource = await harness.ctx.queryRel(rightClip, "resource");
		expect(rightClipResource).toEqual([harness.videoResource]);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("splitSelectedClip clones text node for text clips and keeps bidirectional rels", async () => {
		const harness = await createActionContractHarness();
		await dispatchAndSettle(
			harness.ctx,
			harness.project,
			"addTextClipToVideoTrack",
			{
				name: "Split Text",
				mediaKind: "text",
				start: 10,
				in: 0,
				duration: 4,
				text: {
					content: "Split me",
					style: { fontFamily: "Inter", fontSize: 24, color: "#ffffff" },
					box: { x: 0.2, y: 0.2, width: 0.4, height: 0.2 },
				},
			},
		);

		const textClip = (
			await harness.ctx.queryRel(harness.videoTrack, "clips")
		).find((clip) => harness.ctx.getAttr(clip, "name") === "Split Text");
		expect(textClip).toBeTruthy();

		if (!textClip) {
			throw new Error("Expected text clip");
		}
		const leftTextRelBeforeSplit = await harness.ctx.queryRel(textClip, "text");
		expect(leftTextRelBeforeSplit).toHaveLength(1);
		const leftTextBeforeSplit = leftTextRelBeforeSplit[0];

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			String(textClip._node_id),
		);
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "setCursor", 12);
		const beforeClipIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"splitSelectedClip",
		);

		const afterClips = await harness.ctx.queryRel(harness.videoTrack, "clips");
		const rightClip = afterClips.find(
			(clip) => !beforeClipIds.includes(String(clip._node_id)),
		);
		expect(rightClip).toBeTruthy();
		if (!rightClip) {
			throw new Error("Expected right clip");
		}
		expect(harness.ctx.getAttr(rightClip, "mediaKind")).toBe("text");

		if (!textClip) {
			throw new Error("Expected text clip");
		}
		const leftTextRel = await harness.ctx.queryRel(textClip, "text");
		expect(leftTextRel).toEqual([leftTextBeforeSplit]);

		const rightTextRel = await harness.ctx.queryRel(rightClip, "text");
		expect(rightTextRel).toHaveLength(1);
		const rightText = rightTextRel[0];
		expect(rightText._node_id).not.toBe(leftTextBeforeSplit._node_id);
		expect(harness.ctx.getAttr(rightText, "content")).toBe("Split me");
		expect(harness.ctx.getAttr(rightText, "style")).toEqual(
			harness.ctx.getAttr(leftTextBeforeSplit, "style"),
		);
		expect(harness.ctx.getAttr(rightText, "box")).toEqual(
			harness.ctx.getAttr(leftTextBeforeSplit, "box"),
		);

		const rightTextClipRel = await harness.ctx.queryRel(rightText, "clip");
		expect(rightTextClipRel).toEqual([rightClip]);
		const leftTextClipRel = await harness.ctx.queryRel(
			leftTextBeforeSplit,
			"clip",
		);
		expect(leftTextClipRel).toEqual([textClip]);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("splitSelectedClip is a no-op without a selected clip or a valid split point", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);
		const beforeNodeIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"splitSelectedClip",
		);
		expect(await readNodeIds(harness.ctx, harness.videoTrack, "clips")).toEqual(
			beforeNodeIds,
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "setCursor", 99);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"splitSelectedClip",
		);
		expect(await readNodeIds(harness.ctx, harness.videoTrack, "clips")).toEqual(
			beforeNodeIds,
		);
	});

	it("deleteSelectedClip removes the selected clip and clears selection", async () => {
		const harness = await createActionContractHarness();
		const selectedClipId = String(harness.videoClip._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			selectedClipId,
		);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"deleteSelectedClip",
		);

		const afterDeleteIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		expect(afterDeleteIds).not.toContain(selectedClipId);
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "selectedEntityId"),
		).toBeNull();
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("deleteSelectedClip clears stale selection without removing unrelated clips", async () => {
		const harness = await createActionContractHarness();
		const beforeVideoIds = await readNodeIds(
			harness.ctx,
			harness.videoTrack,
			"clips",
		);
		const beforeAudioIds = await readNodeIds(
			harness.ctx,
			harness.audioTrack,
			"clips",
		);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"selectEntity",
			"clip:missing",
		);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"deleteSelectedClip",
		);

		expect(await readNodeIds(harness.ctx, harness.videoTrack, "clips")).toEqual(
			beforeVideoIds,
		);
		expect(await readNodeIds(harness.ctx, harness.audioTrack, "clips")).toEqual(
			beforeAudioIds,
		);
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "selectedEntityId"),
		).toBeNull();
	});
});
