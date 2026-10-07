import type { PreviewFrame, PreviewFrameSource } from "./frameSource";

/**
 * Adapter from a Node preview frame producer (src/video-editor/media/node/
 * preview) to the presenter's `PreviewFrameSource`. It owns the generation
 * counter, forwards frames to every subscriber and drops frames of superseded
 * generations. The producer is described structurally so this file imports
 * only the GPUIX contract; an in-process producer fits as is, a worker or
 * process channel only has to provide the same two methods.
 */
export type NodePreviewProducer = {
	/** Generations passed in are strictly increasing. */
	request(timeSeconds: number, generation: number): void;
	/** Single frame sink; the sink owns every delivered frame. */
	onFrame(listener: (frame: PreviewFrame) => void): () => void;
};

export type NodePreviewFrameSourceOptions = {
	producer: NodePreviewProducer;
	/** Layout box in logical pixels. */
	width: number;
	height: number;
	/** The producer renders bitmaps of layout size * pixelRatio. */
	pixelRatio?: number;
};

export type NodePreviewFrameSource = PreviewFrameSource & {
	/** Detaches from the producer; later frames are released by the producer. */
	dispose(): void;
};

type Listener = (frame: PreviewFrame) => void;

export const createNodePreviewFrameSource = (
	options: NodePreviewFrameSourceOptions,
): NodePreviewFrameSource => {
	const { producer } = options;
	const listeners = new Set<Listener>();
	let latest = 0;
	let detach: (() => void) | null = null;
	let disposed = false;

	const forward = (frame: PreviewFrame): void => {
		if (frame.generation < latest || listeners.size === 0) {
			frame.release();
			return;
		}
		// The presenter releases every frame it receives exactly once; with
		// several subscribers the producer buffer goes back after the last one.
		const targets = [...listeners];
		let pending = targets.length;
		let failure: { error: unknown } | null = null;
		for (const listener of targets) {
			let called = false;
			const release = (): void => {
				if (called) return;
				called = true;
				pending -= 1;
				if (pending === 0) frame.release();
			};
			try {
				listener({ ...frame, release });
			} catch (error) {
				// A throwing listener still gives its share back; the others
				// still get their frame, and the first error is rethrown.
				release();
				failure ??= { error };
			}
		}
		if (failure) throw failure.error;
	};

	return {
		width: options.width,
		height: options.height,
		pixelRatio: options.pixelRatio ?? 1,
		request(timeSeconds) {
			latest += 1;
			if (!disposed) producer.request(timeSeconds, latest);
			return latest;
		},
		subscribe(listener) {
			listeners.add(listener);
			if (!detach && !disposed) detach = producer.onFrame(forward);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0 && detach) {
					detach();
					detach = null;
				}
			};
		},
		dispose() {
			disposed = true;
			listeners.clear();
			detach?.();
			detach = null;
		},
	};
};
