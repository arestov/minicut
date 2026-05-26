import { describe, expect, it } from "vitest";
import { miniCutEditorRootShape } from "./shapes";

describe("MiniCut page sync shapes", () => {
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
