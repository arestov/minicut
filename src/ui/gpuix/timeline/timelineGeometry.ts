/**
 * Pure view geometry of the timeline: time <-> pixel mapping, culling and
 * ruler ticks. Nothing here knows about the model; callers pass plain numbers.
 */

export const clamp = (value: number, low: number, high: number): number =>
	Math.min(Math.max(high, low), Math.max(low, value));

/** Seconds between ruler ticks so that ticks stay at least `minGapPx` apart. */
export const tickStep = (pxPerSecond: number, minGapPx = 64): number => {
	const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
	return (
		steps.find((step) => step * pxPerSecond >= minGapPx) ??
		steps[steps.length - 1]
	);
};

/** Indexes of the ticks (multiples of the step) that fall in the viewport. */
export const visibleTickIndexes = (args: {
	scrollX: number;
	viewportWidth: number;
	pxPerSecond: number;
	step: number;
	/** Extra pixels kept on both sides so ticks do not pop at the edge. */
	margin?: number;
}): number[] => {
	const margin = args.margin ?? 64;
	const first = Math.max(
		0,
		Math.floor((args.scrollX - margin) / args.pxPerSecond / args.step),
	);
	const last = Math.ceil(
		(args.scrollX + args.viewportWidth + margin) / args.pxPerSecond / args.step,
	);
	const indexes: number[] = [];
	for (let index = first; index <= last; index += 1) {
		indexes.push(index);
	}
	return indexes;
};

/**
 * Whether a clip's horizontal span intersects the viewport (plus margin).
 * Culling is horizontal only: rows are a short, natively scrolled column.
 */
export const isSpanVisible = (args: {
	start: number;
	duration: number;
	pxPerSecond: number;
	scrollX: number;
	viewportWidth: number;
	margin?: number;
}): boolean => {
	const margin = args.margin ?? 120;
	const left = args.start * args.pxPerSecond;
	const right = left + Math.max(2, args.duration * args.pxPerSecond);
	return (
		right >= args.scrollX - margin &&
		left <= args.scrollX + args.viewportWidth + margin
	);
};

/** Window x to timeline seconds, given the lane's left edge in window space. */
export const secondsAtWindowX = (args: {
	x: number;
	laneLeft: number;
	scrollX: number;
	pxPerSecond: number;
}): number =>
	Math.max(0, (args.x - args.laneLeft + args.scrollX) / args.pxPerSecond);

/**
 * New horizontal scroll that keeps the time under the pointer fixed when the
 * zoom changes from `fromPxPerSecond` to `toPxPerSecond`.
 */
export const scrollAfterZoom = (args: {
	pointerOffsetX: number;
	scrollX: number;
	fromPxPerSecond: number;
	toPxPerSecond: number;
}): number => {
	const timeUnderPointer =
		(args.pointerOffsetX + args.scrollX) / args.fromPxPerSecond;
	return Math.max(
		0,
		timeUnderPointer * args.toPxPerSecond - args.pointerOffsetX,
	);
};
