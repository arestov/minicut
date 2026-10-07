/**
 * Node-side preview frame types. `ProducedPreviewFrame` is structurally the
 * GPUIX `PreviewFrame` (src/ui/gpuix/preview/frameSource.ts); this module does
 * not import it so the media layer stays free of UI imports.
 */

export type PreviewFrameFormat = "rgba8-straight";

export interface ProducedPreviewFrame {
	/** Bitmap size in pixels. */
	readonly width: number;
	readonly height: number;
	/** Packed RGBA, straight alpha; valid until `release()`. */
	readonly pixels: Uint8Array;
	/** Bytes per row (tight: width * 4). */
	readonly stride: number;
	readonly format: PreviewFrameFormat;
	/** The request generation this frame answers. */
	readonly generation: number;
	readonly streamId: string;
	/** Position in the stream (0 for single frames). */
	readonly sequence: number;
	/** Timeline time of the picture in seconds. */
	readonly ptsSeconds: number;
	/** Returns the buffer to its pool. Idempotent. */
	release(): void;
}

export interface FrameMeta {
	width: number;
	height: number;
	generation: number;
	streamId: string;
	sequence: number;
	ptsSeconds: number;
}
