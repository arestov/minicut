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
			"$meta$removed": false,
			url: "https://media.example/fixed.mov",
			status: "ready",
			source: {
				kind: "url",
				label: "Fixed media",
				url: "https://media.example/fixed.mov",
				relinkedFromConflictId: "conflict:resource",
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
						localOnlyUrl: false,
						sourceKind: "url",
						affectedClipIds: ["clip:1", "clip:2"],
					},
				},
			},
		});
	});

	it("keeps local-only replacement URLs out of synced source and CRDT result", () => {
		const result = reduceResolveDanglingResourceByRelink(
			{
				conflictId: "conflict:resource",
				reviewItemId: "review:conflict:resource",
				resourceId: "resource:1",
				replacementUrl: "blob://local/fixed.mov",
				source: { kind: "file", url: "blob://local/fixed.mov" },
			},
			resource,
			clips,
		);

		expect(result).toMatchObject({
			url: "blob://local/fixed.mov",
			status: "ready",
			source: {
				kind: "file",
				localOnlyUrl: true,
				relinkedFromConflictId: "conflict:resource",
			},
			crdtResolve: {
				decision: {
					domain_result: {
						replacementUrl: null,
						localOnlyUrl: true,
					},
				},
			},
		});
		expect((result as { source?: Record<string, unknown> } | null)?.source).not.toHaveProperty("url");
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
			"$meta$removed": false,
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

	it("rejects invalid offline placeholder payloads without CRDT resolve", () => {
		const validPayload = {
			conflict_id: "conflict:resource",
			review_item_id: "review:conflict:resource",
			resourceId: "resource:1",
		};

		expect(
			reduceKeepOfflinePlaceholder(
				{ ...validPayload, conflict_id: "" },
				resource,
				clips,
				{ kind: "file", name: "missing.mov" },
			),
		).toBeNull();
		expect(
			reduceKeepOfflinePlaceholder(
				{ ...validPayload, review_item_id: "" },
				resource,
				clips,
				{ kind: "file", name: "missing.mov" },
			),
		).toBeNull();
		expect(
			reduceKeepOfflinePlaceholder(
				{ ...validPayload, resourceId: "resource:other" },
				resource,
				clips,
				{ kind: "file", name: "missing.mov" },
			),
		).toBeNull();
	});
});
