import type { DktTestContext } from "../testingInit";

type RuntimeModel = DktTestContext["sessionRoot"];

type ClipTimingAttrs = {
	start: number;
	in: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
};

const readNumber = (
	ctx: DktTestContext,
	model: RuntimeModel,
	attrName: string,
	fallback: number,
): number => {
	const value = ctx.getAttr(model, attrName);
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const readClipTimingAttrs = (
	ctx: DktTestContext,
	clip: RuntimeModel,
): ClipTimingAttrs => ({
	start: readNumber(ctx, clip, "start", 0),
	in: readNumber(ctx, clip, "in", 0),
	duration: readNumber(ctx, clip, "duration", 0),
	fadeIn: readNumber(ctx, clip, "fadeIn", 0),
	fadeOut: readNumber(ctx, clip, "fadeOut", 0),
});

export const dispatchClipTimingResizeGesture = async (
	ctx: DktTestContext,
	clip: RuntimeModel,
	{
		edge,
		delta,
		batchId,
	}: { edge: "start" | "end"; delta: number; batchId: string },
): Promise<void> => {
	const original = readClipTimingAttrs(ctx, clip);
	const meta = { intent: { batch_id: batchId } };
	await clip.dispatch("previewResize", { edge, delta }, null, meta);
	const finalAttrs = readClipTimingAttrs(ctx, clip);
	await clip.dispatch("cleanupTimelineGesture", original, null, meta);
	await clip.dispatch("commitTimelineAttrs", finalAttrs, null, meta);
};
