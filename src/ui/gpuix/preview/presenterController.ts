import type { PreviewFrame, PreviewFrameSource } from "./frameSource";

export type FramePresenterStats = {
	/** Frames uploaded to the target. */
	presented: number;
	/** Frames dropped because a newer generation was already requested (or after dispose). */
	droppedStale: number;
	/** Frames dropped because their size, stride or format was not acceptable. */
	droppedInvalid: number;
	/** Frames dropped because the target could not take them yet. */
	droppedNotReady: number;
};

export type FramePresenter = {
	/** Requests the frame for a timeline time (the model cursor). */
	show(timeSeconds: number): void;
	/**
	 * Tells the presenter its target can take frames now. When a frame was
	 * dropped as not ready, the latest request is issued again.
	 */
	targetReady(): void;
	readonly stats: Readonly<FramePresenterStats>;
	dispose(): void;
};

const BYTES_PER_PIXEL = 4;

/**
 * Takes frames from a source and hands each current one to `upload` as a
 * tight RGBA buffer. Frames of an older generation than the latest request
 * are dropped: only the frame answering the newest request is ever shown. The
 * presenter keeps no source frame between calls (it owns one scratch buffer
 * for repacking strided frames) and releases every delivered frame exactly
 * once, so buffer use stays bounded by what the source pools.
 */
export const createFramePresenter = (
	source: PreviewFrameSource,
	/** Uploads a tight frame; returns false when the target cannot take it yet. */
	upload: (frame: { width: number; height: number; pixels: Uint8Array }) => boolean,
): FramePresenter => {
	const stats: FramePresenterStats = {
		presented: 0,
		droppedStale: 0,
		droppedInvalid: 0,
		droppedNotReady: 0,
	};
	const expectedWidth = Math.round(source.width * source.pixelRatio);
	const expectedHeight = Math.round(source.height * source.pixelRatio);
	const tightRow = expectedWidth * BYTES_PER_PIXEL;
	let scratch: Uint8Array | null = null;
	let latestGeneration = -1;
	let latestTime: number | null = null;
	let retryNeeded = false;
	let disposed = false;

	const tightPixels = (frame: PreviewFrame, stride: number): Uint8Array => {
		if (stride === tightRow) return frame.pixels;
		scratch ??= new Uint8Array(tightRow * expectedHeight);
		for (let row = 0; row < expectedHeight; row += 1) {
			scratch.set(
				frame.pixels.subarray(row * stride, row * stride + tightRow),
				row * tightRow,
			);
		}
		return scratch;
	};

	const unsubscribe = source.subscribe((frame) => {
		try {
			if (disposed || frame.generation < latestGeneration) {
				stats.droppedStale += 1;
				return;
			}
			const stride = frame.stride ?? frame.width * BYTES_PER_PIXEL;
			if (
				(frame.format ?? "rgba8-straight") !== "rgba8-straight" ||
				frame.width !== expectedWidth ||
				frame.height !== expectedHeight ||
				stride < tightRow ||
				frame.pixels.length < stride * frame.height
			) {
				stats.droppedInvalid += 1;
				return;
			}
			if (
				upload({
					width: frame.width,
					height: frame.height,
					pixels: tightPixels(frame, stride),
				})
			) {
				stats.presented += 1;
			} else {
				stats.droppedNotReady += 1;
				retryNeeded = true;
			}
		} finally {
			frame.release();
		}
	});

	return {
		show(timeSeconds) {
			if (disposed) return;
			latestTime = timeSeconds;
			retryNeeded = false;
			latestGeneration = source.request(timeSeconds);
		},
		targetReady() {
			if (disposed || !retryNeeded || latestTime === null) return;
			retryNeeded = false;
			latestGeneration = source.request(latestTime);
		},
		stats,
		dispose() {
			disposed = true;
			unsubscribe();
		},
	};
};
