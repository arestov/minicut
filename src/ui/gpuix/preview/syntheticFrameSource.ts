import type { PreviewFrame, PreviewFrameSource } from "./frameSource";

/**
 * JS-generated preview frames. Placeholder for the real frame stream of the
 * desktop host: same contract (packed RGBA, straight alpha, bitmap sized to
 * the layout box times the pixel ratio) so the presenter does not change when
 * the source does.
 */

export type SyntheticFrame = {
	/** Bitmap size in physical pixels (layout size * pixelRatio). */
	width: number;
	height: number;
	/** Packed RGBA, straight (non-premultiplied) alpha. */
	pixels: Uint8Array;
};

export type SyntheticFrameSourceOptions = {
	/** Layout box in logical pixels. */
	width: number;
	height: number;
	/** Bitmaps are uploaded at 2x for DPI: there is no density argument. */
	pixelRatio?: number;
	/** Loop length of the animation in seconds. */
	loopSeconds?: number;
};

export type SyntheticFrameSource = {
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
	/**
	 * Renders the frame for a timeline time. The returned pixel buffer is
	 * reused by the next call: upload it before rendering again.
	 */
	frameAt(timeSeconds: number): SyntheticFrame;
};

// 3x5 digit glyphs, one row per entry, bit 2 is the leftmost column.
const GLYPHS: Record<string, readonly number[]> = {
	"0": [0b111, 0b101, 0b101, 0b101, 0b111],
	"1": [0b010, 0b110, 0b010, 0b010, 0b111],
	"2": [0b111, 0b001, 0b111, 0b100, 0b111],
	"3": [0b111, 0b001, 0b111, 0b001, 0b111],
	"4": [0b101, 0b101, 0b111, 0b001, 0b001],
	"5": [0b111, 0b100, 0b111, 0b001, 0b111],
	"6": [0b111, 0b100, 0b111, 0b101, 0b111],
	"7": [0b111, 0b001, 0b010, 0b010, 0b010],
	"8": [0b111, 0b101, 0b111, 0b101, 0b111],
	"9": [0b111, 0b101, 0b111, 0b001, 0b111],
	":": [0b000, 0b010, 0b000, 0b010, 0b000],
	".": [0b000, 0b000, 0b000, 0b000, 0b010],
};

export const formatTimecode = (timeSeconds: number): string => {
	const total = Math.max(0, timeSeconds);
	const minutes = Math.floor(total / 60);
	const seconds = Math.floor(total % 60);
	const hundredths = Math.floor((total * 100) % 100);
	const pad = (value: number, length: number) =>
		String(value).padStart(length, "0");
	return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(hundredths, 2)}`;
};

const setPixel = (
	pixels: Uint8Array,
	width: number,
	x: number,
	y: number,
	r: number,
	g: number,
	b: number,
	a: number,
) => {
	const offset = (y * width + x) * 4;
	pixels[offset] = r;
	pixels[offset + 1] = g;
	pixels[offset + 2] = b;
	pixels[offset + 3] = a;
};

export const createSyntheticFrameSource = (
	options: SyntheticFrameSourceOptions,
): SyntheticFrameSource => {
	const pixelRatio = options.pixelRatio ?? 2;
	const loopSeconds = options.loopSeconds ?? 8;
	const width = Math.round(options.width * pixelRatio);
	const height = Math.round(options.height * pixelRatio);
	if (!(width > 0 && height > 0)) {
		throw new Error("Synthetic frame size must be positive");
	}
	const pixels = new Uint8Array(width * height * 4);
	const frame: SyntheticFrame = { width, height, pixels };

	const drawTimecode = (text: string, scale: number, left: number, top: number) => {
		let cursor = left;
		for (const char of text) {
			const glyph = GLYPHS[char];
			if (glyph) {
				for (let row = 0; row < 5; row += 1) {
					for (let column = 0; column < 3; column += 1) {
						if (((glyph[row] >> (2 - column)) & 1) === 0) continue;
						for (let dy = 0; dy < scale; dy += 1) {
							for (let dx = 0; dx < scale; dx += 1) {
								const x = cursor + column * scale + dx;
								const y = top + row * scale + dy;
								if (x < width && y < height) {
									setPixel(pixels, width, x, y, 255, 255, 255, 255);
								}
							}
						}
					}
				}
			}
			cursor += 4 * scale;
		}
	};

	return {
		width,
		height,
		pixelRatio,
		frameAt(timeSeconds) {
			const phase = (((timeSeconds % loopSeconds) + loopSeconds) % loopSeconds) /
				loopSeconds;
			const barX = Math.floor(phase * (width - 1));
			const tile = 16 * pixelRatio;

			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					const checker = ((Math.floor(x / tile) + Math.floor(y / tile)) & 1) === 0;
					const shade = checker ? 0 : 10;
					setPixel(
						pixels,
						width,
						x,
						y,
						Math.round(30 + (x / width) * 60) + shade,
						Math.round(40 + (y / height) * 60) + shade,
						Math.round(120 + phase * 100) + shade,
						255,
					);
				}
			}

			// A translucent band exercises straight alpha: the color channels are
			// not premultiplied, so (255, 200, 0, 96) must stay (255, 200, 0, 96).
			const bandTop = Math.floor(height * 0.62);
			const bandBottom = Math.floor(height * 0.78);
			for (let y = bandTop; y < bandBottom; y += 1) {
				for (let x = 0; x < width; x += 1) {
					setPixel(pixels, width, x, y, 255, 200, 0, 96);
				}
			}

			// Moving bar: makes frame changes visible and the time recoverable.
			const barWidth = Math.max(2, Math.round(2 * pixelRatio));
			for (let y = 0; y < height; y += 1) {
				for (let x = barX; x < Math.min(width, barX + barWidth); x += 1) {
					setPixel(pixels, width, x, y, 255, 255, 255, 255);
				}
			}

			const scale = Math.max(1, Math.round(3 * pixelRatio));
			drawTimecode(formatTimecode(timeSeconds), scale, 4 * pixelRatio, 4 * pixelRatio);

			return frame;
		},
	};
};

export type SyntheticPreviewSourceOptions = SyntheticFrameSourceOptions & {
	/**
	 * Runs deferred work. When set, frames are delivered through it instead of
	 * inside `request`, each in its own pooled buffer, so a frame can arrive
	 * after a newer request like frames from a real stream. Hosts pass their
	 * own scheduler; tests pass one they run by hand.
	 */
	schedule?: (run: () => void) => void;
	/** Called when a frame listener throws; delivery to the others continues. */
	onListenerError?: (error: unknown) => void;
};

/**
 * The synthetic generator as a `PreviewFrameSource`.
 *
 * Without `schedule`, each request renders its frame at once into one reused
 * buffer and delivers it to the listeners; the buffer is overwritten by the
 * next request, which is why the presenter uploads inside the listener and
 * releases the frame right away. With `schedule`, each frame is copied into a
 * pooled buffer that is returned to the pool by `release`.
 */
export const createSyntheticPreviewSource = (
	options: SyntheticPreviewSourceOptions,
): PreviewFrameSource => {
	const generator = createSyntheticFrameSource(options);
	const listeners = new Set<(frame: PreviewFrame) => void>();
	const pool: Uint8Array[] = [];
	const reportError = options.onListenerError ?? ((error) => console.error(error));
	let generation = 0;

	const deliver = (frame: PreviewFrame) => {
		let delivered = 0;
		for (const listener of [...listeners]) {
			try {
				listener(frame);
				delivered += 1;
			} catch (error) {
				reportError(error);
			}
		}
		// Nobody took the frame: it goes straight back.
		if (delivered === 0 && listeners.size === 0) frame.release();
	};

	return {
		width: options.width,
		height: options.height,
		pixelRatio: generator.pixelRatio,
		request(timeSeconds) {
			generation += 1;
			const current = generation;
			const frame = generator.frameAt(timeSeconds);
			const { schedule } = options;
			if (!schedule) {
				deliver({
					width: frame.width,
					height: frame.height,
					pixels: frame.pixels,
					generation: current,
					release() {},
				});
				return current;
			}
			const pixels = pool.pop() ?? new Uint8Array(frame.pixels.length);
			pixels.set(frame.pixels);
			let released = false;
			schedule(() =>
				deliver({
					width: frame.width,
					height: frame.height,
					pixels,
					generation: current,
					release() {
						// Idempotent: a frame must not enter the pool twice.
						if (released) return;
						released = true;
						pool.push(pixels);
					},
				}),
			);
			return current;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};
