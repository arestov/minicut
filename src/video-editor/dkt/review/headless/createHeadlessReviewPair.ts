import { createCrdtWorkerPair } from "../../test/createCrdtWorkerPair";
import {
	waitForProjectReviewGraph,
	type ProjectReviewGraphSnapshot,
} from "../testHarness/inspectReviewGraph";
import type { MiniCutReviewKind, MiniCutReviewItem } from "../types";
import { reviewItemFromGraphNode } from "./reviewItemFromGraphNode";

type WorkerPair = Awaited<ReturnType<typeof createCrdtWorkerPair>>;
export type HeadlessReviewPair = WorkerPair & {
	waitForReviewGraph: (
		predicate: (graph: ProjectReviewGraphSnapshot) => boolean,
		options?: { peer?: HeadlessReviewPeer; timeoutMs?: number; intervalMs?: number },
	) => Promise<ProjectReviewGraphSnapshot>;
	waitForReviewItem: (
		kind: MiniCutReviewKind | string,
		options?: { peer?: HeadlessReviewPeer; timeoutMs?: number; intervalMs?: number },
	) => Promise<MiniCutReviewItem>;
};
export type HeadlessReviewPeer = WorkerPair["a"];
export type HeadlessDktModel = HeadlessReviewPeer["project"];

export const createHeadlessReviewPair = async (
	roomId: string,
): Promise<HeadlessReviewPair> => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});

	const waitForReviewGraph = async (
		predicate: (graph: ProjectReviewGraphSnapshot) => boolean,
		options: { peer?: HeadlessReviewPeer; timeoutMs?: number; intervalMs?: number } = {},
	): Promise<ProjectReviewGraphSnapshot> => {
		const peer = options.peer ?? pair.a;
		return waitForProjectReviewGraph(peer.ctx, peer.project, predicate, {
			timeoutMs: options.timeoutMs ?? 10_000,
			intervalMs: options.intervalMs,
		});
	};

	const waitForReviewItem = async (
		kind: MiniCutReviewKind | string,
		options: { peer?: HeadlessReviewPeer; timeoutMs?: number; intervalMs?: number } = {},
	): Promise<MiniCutReviewItem> => {
		const graph = await waitForReviewGraph(
			(snapshot) =>
				snapshot.items.some((item) =>
					reviewItemFromGraphNode(item).kind === kind,
				),
			options,
		);
		const item = graph.items
			.map(reviewItemFromGraphNode)
			.find((entry) => entry.kind === kind);
		if (!item) {
			throw new Error(`Expected review item kind ${kind}`);
		}
		return item;
	};

	return {
		...pair,
		waitForReviewGraph,
		waitForReviewItem,
	};
};