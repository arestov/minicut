import type { CrdtActionTrace } from "../../types";

const rootFrameId = (
	frameId: number,
	frameById: Map<number, CrdtActionTrace["frames"][number]>,
	seen = new Set<number>(),
): number => {
	if (seen.has(frameId)) {
		return frameId;
	}
	seen.add(frameId);
	const frame = frameById.get(frameId);
	const parent = frame?.parent_frame_id ?? null;
	return parent == null ? frameId : rootFrameId(parent, frameById, seen);
};

export const frameRootIdForProducedOp = (
	trace: CrdtActionTrace,
	opId: string,
): number | null => {
	const produced = trace.produced_ops.find((item) => item.op_id === opId);
	if (!produced) {
		return null;
	}
	return rootFrameId(
		produced.frame_id,
		new Map(trace.frames.map((frame) => [frame.frame_id, frame])),
	);
};

export const summarizeActionTraceRoots = (
	trace: CrdtActionTrace | null,
): Array<{ frameId: number; opCount: number; createCount: number }> => {
	if (!trace) {
		return [];
	}
	const frameById = new Map(trace.frames.map((frame) => [frame.frame_id, frame]));
	const byRoot = new Map<number, { frameId: number; opCount: number; createCount: number }>();
	const ensure = (frameId: number) => {
		const root = rootFrameId(frameId, frameById);
		const current = byRoot.get(root) ?? { frameId: root, opCount: 0, createCount: 0 };
		byRoot.set(root, current);
		return current;
	};
	for (const item of trace.produced_ops) {
		ensure(item.frame_id).opCount += 1;
	}
	for (const item of trace.produced_creates) {
		ensure(item.frame_id).createCount += 1;
	}
	return [...byRoot.values()].sort((a, b) => a.frameId - b.frameId);
};
