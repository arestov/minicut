import type { DktTestContext } from "../testingInit";

type RuntimeModel = DktTestContext["sessionRoot"];

type ClipTimingAttrs = {
	start: number;
	in: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
};

const readNumber = async (
	ctx: DktTestContext,
	model: RuntimeModel,
	attrName: string,
	fallback: number,
): Promise<number> => {
	const value = await ctx.queryAttr(model, attrName);
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const readClipTimingAttrs = async (
	ctx: DktTestContext,
	clip: RuntimeModel,
): Promise<ClipTimingAttrs> => ({
	start: await readNumber(ctx, clip, "start", 0),
	in: await readNumber(ctx, clip, "in", 0),
	duration: await readNumber(ctx, clip, "duration", 0),
	fadeIn: await readNumber(ctx, clip, "fadeIn", 0),
	fadeOut: await readNumber(ctx, clip, "fadeOut", 0),
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
	const original = await readClipTimingAttrs(ctx, clip);
	const meta = { intent: { batch_id: batchId } };
	await clip.dispatch("previewResize", { edge, delta }, null, meta);
	const finalAttrs =
		edge === "start"
			? {
					...original,
					start: original.start + delta,
					in: original.in + delta,
					duration: original.duration - delta,
				}
			: {
					...original,
					duration: original.duration + delta,
				};
	await clip.dispatch("cleanupTimelineGesture", original, null, meta);
	await clip.dispatch("commitTimelineAttrs", finalAttrs, null, meta);
};
