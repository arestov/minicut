import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeCrdtAcknowledgePayload, makeCrdtResolvePayload } from "./crdtReviewCommands";

describe("crdtReviewCommands", () => {
	it("builds stable MiniCut resolve payloads", () => {
		expect(
			makeCrdtResolvePayload({
				conflictId: "conflict:1",
				reviewItemId: "review:1",
				action: "resolveClipTimingConflict",
				domainResult: { start: 1 },
			}),
		).toEqual({
			conflict_id: "conflict:1",
			decision: {
				app: "minicut",
				decision_id: "resolveClipTimingConflict:review:1:conflict:1",
				action: "resolveClipTimingConflict",
				review_item_id: "review:1",
				domain_result: { start: 1 },
			},
		});
	});

	it("builds acknowledge payloads without runtime dispatch", () => {
		expect(
			makeCrdtAcknowledgePayload({
				conflictId: "conflict:1",
				reviewItemId: "review:1",
				action: "acknowledgeReviewItem",
			}),
		).toEqual({
			conflict_id: "conflict:1",
			actor: "minicut",
			review_item_id: "review:1",
			action: "acknowledgeReviewItem",
		});
	});

	it("does not import runtime, React, DKT dispatch, or transport modules", () => {
		const source = readFileSync(
			resolve("src/video-editor/dkt/review/crdtReviewCommands.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/from "react"|from 'react'/);
		expect(source).not.toMatch(/dispatchCRDTCommand|useActions|dispatch\(/);
		expect(source).not.toMatch(/transport|runtime|subscribe/);
	});
});
