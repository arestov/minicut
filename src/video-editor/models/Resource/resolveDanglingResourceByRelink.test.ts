import { describe, expect, it } from "vitest";
import {
	reduceKeepOfflinePlaceholder,
	reduceResolveDanglingResourceByRelink,
} from "./actions";

describe("dangling resource review actions", () => {
	const resource = { _node_id: "resource:1" };
	const clips = [{ _node_id: "clip:1" }, { _node_id: "clip:2" }];

	it("relinks a missing resource and emits a CRDT resolve command", () => {
		const result = reduceResolveDanglingResourceByRelink(
			{
				conflictId: "conflict:resource",
				reviewItemId: "review:conflict:resource",
				resourceId: "resource:1",
				replacementUrl: "https://media.example/fixed.mov",
				source: { kind: "url", label: "Fixed media" },
				data: { width: 1920 },
			},
			resource,
			clips,
		);

		expect(result).toMatchObject({
			url: "https://media.example/fixed.mov",
			status: "ready",
			source: {
				kind: "url",
				label: "Fixed media",
				url: "https://media.example/fixed.mov",
			},
			data: { width: 1920 },
			crdtResolve: {
				conflict_id: "conflict:resource",
				decision: {
					action: "resolveDanglingResourceByRelink",
					review_item_id: "review:conflict:resource",
					domain_result: {
						type: "resource_relinked",
						resourceId: "resource:1",
						replacementUrl: "https://media.example/fixed.mov",
						sourceKind: "url",
						affectedClipIds: ["clip:1", "clip:2"],
					},
				},
			},
		});
	});

	it("rejects invalid relink payloads without writing resource attrs or CRDT resolve", () => {
		expect(
			reduceResolveDanglingResourceByRelink(
				{
					conflictId: "conflict:resource",
					reviewItemId: "review:conflict:resource",
					resourceId: "resource:1",
					replacementUrl: "",
				},
				resource,
				clips,
			),
		).toBeNull();
	});

	it("keeps an explicit offline placeholder and emits a CRDT resolve command", () => {
		const result = reduceKeepOfflinePlaceholder(
			{
				conflict_id: "conflict:resource",
				review_item_id: "review:conflict:resource",
				resourceId: "resource:1",
			},
			resource,
			clips,
			{ kind: "file", name: "missing.mov" },
		);

		expect(result).toMatchObject({
			status: "offline",
			source: {
				kind: "offline_placeholder",
				name: "missing.mov",
				keptFromConflictId: "conflict:resource",
			},
			crdtResolve: {
				conflict_id: "conflict:resource",
				decision: {
					action: "keepOfflinePlaceholder",
					review_item_id: "review:conflict:resource",
					domain_result: {
						type: "offline_placeholder_kept",
						resourceId: "resource:1",
						affectedClipIds: ["clip:1", "clip:2"],
					},
				},
			},
		});
	});
});
