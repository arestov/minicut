import { describe, expect, it } from "vitest";
import { miniCutEditorRootShape } from "./shapes";

describe("MiniCut page sync shapes", () => {
 it("loads correction metadata and scopes while retaining source effects", () => {
  const clip = miniCutEditorRootShape.one?.activeProject?.many?.tracks?.many?.clips;
  expect(clip?.attrs).toEqual(expect.arrayContaining(["$meta$rels$effects$exists", "$meta$rels$colorCorrectionEffects$exists"]));
  expect(clip?.many?.colorCorrectionEffects?.attrs).toEqual(expect.arrayContaining(["enabled", "params"]));
  expect(clip?.many?.effects).toEqual(clip?.many?.colorCorrectionEffects);
  expect(miniCutEditorRootShape.one?.selectedClip).toEqual(clip);
 });
	it("requests clip conflict relation and conflict projection attrs", () => {
		const clipShape =
			miniCutEditorRootShape.one?.activeProject?.many?.tracks?.many?.clips;
		const conflictShape = clipShape?.many?.crdtConflicts;

		expect(conflictShape).toBeTruthy();
		expect(conflictShape?.attrs).toEqual([
			"id",
			"kind",
			"scope",
			"summary",
			"decision",
		]);
	});
});
