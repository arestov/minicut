/**
 * Contract between a producer of preview frames and the presenter. The
 * synthetic source implements it now; the Node frame stream of the desktop
 * host implements the same contract, so the presenter does not change.
 */

/** Pixel layouts the presenter can upload. Only straight-alpha RGBA today. */
export type PreviewFrameFormat = "rgba8-straight";

export type PreviewFrame = {
	/** Bitmap size in physical pixels (layout size * pixelRatio). */
	width: number;
	height: number;
	/**
	 * Packed pixels in `format`. Rows are `stride` bytes apart; the buffer
	 * holds at least `stride * height` bytes.
	 */
	pixels: Uint8Array;
	/** Bytes per row. Defaults to the tight row, `width * 4`. */
	stride?: number;
	/** Defaults to `rgba8-straight`. */
	format?: PreviewFrameFormat;
	/**
	 * The `request` generation this frame answers. Staleness is decided on
	 * this value only.
	 */
	generation: number;
	/** Identity of the producing stream (informational; not used for staleness). */
	streamId?: string;
	/** Position in the stream (informational). */
	sequence?: number;
	/** Presentation timestamp of the frame in timeline seconds (informational). */
	ptsSeconds?: number;
	/**
	 * Returns the pixel buffer to the source. Required: the presenter owns a
	 * delivered frame until it calls `release`, which it does exactly once for
	 * every frame passed to the listener (uploaded, dropped, or arriving after
	 * dispose) and never touches `pixels` afterwards. A frame the source
	 * cannot deliver because the listener is already unsubscribed stays the
	 * source's to release.
	 */
	release(): void;
};

export type PreviewFrameSource = {
	/** Layout box in logical pixels. */
	readonly width: number;
	readonly height: number;
	/** Bitmaps are uploaded at this multiple of the layout size (2 for DPI). */
	readonly pixelRatio: number;
	/**
	 * Asks for the frame at a timeline time and returns the generation of the
	 * request. A frame may arrive later (and out of order with newer
	 * requests); it carries the generation it answers.
	 */
	request(timeSeconds: number): number;
	/** Registers the frame listener; returns the unsubscribe function. */
	subscribe(listener: (frame: PreviewFrame) => void): () => void;
};
