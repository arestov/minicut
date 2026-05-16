import { expect } from "vitest";
import type { MiniCutDktCrdtRuntime } from "../testingInit";

type RuntimeWithCrdt = {
	crdt_runtime?: MiniCutDktCrdtRuntime | null;
};

export const getCrdtDebugState = (runtime: RuntimeWithCrdt) => {
	const crdtRuntime = runtime.crdt_runtime ?? null;
	return {
		enabled: Boolean(crdtRuntime),
		peerId: crdtRuntime?.peer_id ?? null,
		outbox: [...(crdtRuntime?.outbox ?? [])],
		durableLog: crdtRuntime?.testing?.peekDurableLog?.() ?? [],
	};
};

export const drainCrdtOutbox = (runtime: RuntimeWithCrdt): unknown[] =>
	runtime.crdt_runtime?.testing?.drainOutbox?.() ?? [];

export const expectCrdtOutboxContains = (
	ops: readonly unknown[],
	partial: Record<string, unknown>,
) => {
	expect(ops).toEqual(expect.arrayContaining([expect.objectContaining(partial)]));
};

export const expectNoCrdtStagedOps = (runtime: RuntimeWithCrdt) => {
	expect(drainCrdtOutbox(runtime)).toEqual([]);
};

export const expectCrdtMetaCount = (
	model: { states?: Record<string, unknown> },
	attrName: string,
	expected: number,
) => {
	expect(model.states?.[attrName] ?? 0).toBe(expected);
};
