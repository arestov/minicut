import { describe, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { createSignal } from "solid-js";
import { FramePresenter } from "./FramePresenter";
import { createFramePresenter } from "./presenterController";
import type { PreviewFrame, PreviewFrameSource } from "./frameSource";
import { createSyntheticPreviewSource } from "./syntheticFrameSource";

const WIDTH = 8;
const HEIGHT = 4;
const RATIO = 2;
const BITMAP_WIDTH = WIDTH * RATIO;
const BITMAP_HEIGHT = HEIGHT * RATIO;

/**
 * A source the test drives by hand: `request` only numbers the request,
 * frames are delivered when the test calls `deliver`. It pools two buffers
 * and fails when the presenter does not give them back.
 */
const createManualSource = () => {
	const listeners = new Set<(frame: PreviewFrame) => void>();
	const requests: number[] = [];
	// Listeners are kept after unsubscribe to model frames still in flight.
	const everSubscribed: Array<(frame: PreviewFrame) => void> = [];
	const free = [
		new Uint8Array(BITMAP_WIDTH * BITMAP_HEIGHT * 4),
		new Uint8Array(BITMAP_WIDTH * BITMAP_HEIGHT * 4),
	];
	let generation = 0;
	let delivered = 0;
	let released = 0;

	const source: PreviewFrameSource = {
		width: WIDTH,
		height: HEIGHT,
		pixelRatio: RATIO,
		request(time) {
			generation += 1;
			requests.push(time);
			return generation;
		},
		subscribe(listener) {
			listeners.add(listener);
			everSubscribed.push(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};

	return {
		source,
		requests,
		/** A frame still in flight when the presenter unsubscribed. */
		deliverLate(frameGeneration: number) {
			const pixels = free.pop();
			if (!pixels) throw new Error("buffer pool exhausted");
			delivered += 1;
			for (const listener of everSubscribed) {
				listener({
					width: BITMAP_WIDTH,
					height: BITMAP_HEIGHT,
					pixels,
					generation: frameGeneration,
					release() {
						released += 1;
						free.push(pixels);
					},
				});
			}
		},
		/** Delivers a frame with explicit layout fields. */
		deliverCustom(frame: Partial<PreviewFrame> & { pixels: Uint8Array; generation: number }) {
			delivered += 1;
			for (const listener of [...listeners]) {
				listener({
					width: BITMAP_WIDTH,
					height: BITMAP_HEIGHT,
					release() {
						released += 1;
					},
					...frame,
				});
			}
		},
		counts: () => ({ delivered, released, free: free.length }),
		deliver(
			frameGeneration: number,
			size: { width: number; height: number } = {
				width: BITMAP_WIDTH,
				height: BITMAP_HEIGHT,
			},
		) {
			const pixels = free.pop();
			if (!pixels) throw new Error("buffer pool exhausted: the presenter kept a frame");
			const bytes =
				size.width === BITMAP_WIDTH && size.height === BITMAP_HEIGHT
					? pixels
					: new Uint8Array(size.width * size.height * 4);
			bytes.fill(frameGeneration);
			delivered += 1;
			for (const listener of [...listeners]) {
				listener({
					...size,
					pixels: bytes,
					generation: frameGeneration,
					release() {
						released += 1;
						free.push(pixels);
					},
				});
			}
		},
	};
};

describe("frame presenter", () => {
	test("uploads the frame that answers the latest request", () => {
		const manual = createManualSource();
		const uploads: number[] = [];
		const presenter = createFramePresenter(manual.source, (frame) => {
			uploads.push(frame.pixels[0]);
			return true;
		});

		presenter.show(1);
		manual.deliver(1);

		expect(uploads).toEqual([1]);
		expect(presenter.stats.presented).toBe(1);
	});

	test("drops a frame older than the latest request", () => {
		const manual = createManualSource();
		const uploads: number[] = [];
		const presenter = createFramePresenter(manual.source, (frame) => {
			uploads.push(frame.pixels[0]);
			return true;
		});

		presenter.show(1);
		presenter.show(2);
		presenter.show(3);
		// The answer to request 1 arrives after request 3 was made.
		manual.deliver(1);
		manual.deliver(3);
		// And a late answer to request 2 after the newer frame was shown.
		manual.deliver(2);

		expect(uploads).toEqual([3]);
		expect(presenter.stats).toMatchObject({ presented: 1, droppedStale: 2 });
	});

	test("releases every delivered frame once, so a two-buffer pool never runs dry", () => {
		const manual = createManualSource();
		let uploads = 0;
		const presenter = createFramePresenter(manual.source, () => (uploads += 1) % 2 === 0);

		for (let index = 0; index < 50; index += 1) {
			presenter.show(index);
			manual.deliver(index + 1);
		}
		presenter.show(99);
		manual.deliver(1);
		manual.deliver(0, { width: 3, height: 3 });

		expect(manual.counts()).toEqual({ delivered: 52, released: 52, free: 2 });
	});

	test("drops frames with the wrong bitmap size and frames the target cannot take", () => {
		const manual = createManualSource();
		let ready = false;
		const presenter = createFramePresenter(manual.source, () => ready);

		presenter.show(0);
		manual.deliver(1, { width: BITMAP_WIDTH / 2, height: BITMAP_HEIGHT / 2 });
		manual.deliver(1);
		ready = true;
		presenter.show(1);
		manual.deliver(2);

		expect(presenter.stats).toEqual({
			presented: 1,
			droppedStale: 0,
			droppedInvalid: 1,
			droppedNotReady: 1,
		});
	});

	test("a frame dropped as not ready is requested again when the target becomes ready", () => {
		const manual = createManualSource();
		let ready = false;
		const uploads: number[] = [];
		const presenter = createFramePresenter(manual.source, (frame) => {
			if (!ready) return false;
			uploads.push(frame.pixels[0]);
			return true;
		});

		presenter.show(4);
		manual.deliver(1);
		expect(presenter.stats.droppedNotReady).toBe(1);
		expect(manual.requests).toEqual([4]);

		ready = true;
		presenter.targetReady();
		expect(manual.requests).toEqual([4, 4]);
		manual.deliver(2);
		expect(uploads).toEqual([2]);

		// Nothing is re-requested when nothing was dropped.
		presenter.targetReady();
		expect(manual.requests).toEqual([4, 4]);
	});

	test("uploads a strided frame repacked into tight rows and rejects other formats", () => {
		const manual = createManualSource();
		const uploads: Uint8Array[] = [];
		const presenter = createFramePresenter(manual.source, (frame) => {
			uploads.push(Uint8Array.from(frame.pixels));
			return true;
		});
		const tightRow = BITMAP_WIDTH * 4;
		const stride = tightRow + 8;
		const strided = new Uint8Array(stride * BITMAP_HEIGHT);
		for (let row = 0; row < BITMAP_HEIGHT; row += 1) {
			strided.fill(row + 1, row * stride, row * stride + tightRow);
			strided.fill(255, row * stride + tightRow, (row + 1) * stride);
		}

		presenter.show(0);
		manual.deliverCustom({ pixels: strided, stride, generation: 1 });
		expect(uploads).toHaveLength(1);
		expect(uploads[0].length).toBe(tightRow * BITMAP_HEIGHT);
		expect(uploads[0][0]).toBe(1);
		expect(uploads[0][tightRow]).toBe(2);
		expect(uploads[0].includes(255)).toBe(false);

		// Short buffer for its stride, stride below the row, unknown format.
		manual.deliverCustom({ pixels: new Uint8Array(stride), stride, generation: 1 });
		manual.deliverCustom({ pixels: new Uint8Array(tightRow * BITMAP_HEIGHT), stride: tightRow - 4, generation: 1 });
		manual.deliverCustom({
			pixels: new Uint8Array(tightRow * BITMAP_HEIGHT),
			format: "bgra8" as never,
			generation: 1,
		});
		expect(presenter.stats).toMatchObject({ presented: 1, droppedInvalid: 3 });
		expect(manual.counts().released).toBe(manual.counts().delivered);
	});

	test("a frame arriving after dispose is released by the presenter, not uploaded", () => {
		const manual = createManualSource();
		let uploads = 0;
		const presenter = createFramePresenter(manual.source, () => {
			uploads += 1;
			return true;
		});
		presenter.show(1);
		presenter.dispose();

		manual.deliverLate(1);

		expect(uploads).toBe(0);
		expect(manual.counts()).toEqual({ delivered: 1, released: 1, free: 2 });
	});

	test("stops reacting after dispose", () => {
		const manual = createManualSource();
		let uploads = 0;
		const presenter = createFramePresenter(manual.source, () => {
			uploads += 1;
			return true;
		});

		presenter.dispose();
		presenter.show(1);
		manual.deliver(1);

		expect(manual.requests).toEqual([]);
		expect(uploads).toBe(0);
	});
});

describe("synthetic preview source", () => {
	const options = { width: 8, height: 4 };

	test("one throwing listener does not stop delivery to the others", () => {
		const errors: unknown[] = [];
		const source = createSyntheticPreviewSource({
			...options,
			onListenerError: (error) => errors.push(error),
		});
		const seen: number[] = [];
		source.subscribe(() => {
			throw new Error("listener failed");
		});
		source.subscribe((frame) => seen.push(frame.generation));

		source.request(0);

		expect(seen).toEqual([1]);
		expect(errors).toHaveLength(1);
	});

	test("deferred delivery: a late frame of an older generation is dropped and released", () => {
		const queue: Array<() => void> = [];
		const source = createSyntheticPreviewSource({
			...options,
			schedule: (run) => queue.push(run),
		});
		let released = 0;
		let delivered = 0;
		const uploads: number[] = [];
		const presenter = createFramePresenter(
			{
				...source,
				subscribe: (listener) =>
					source.subscribe((frame) => {
						delivered += 1;
						listener({
							...frame,
							release() {
								released += 1;
								frame.release();
							},
						});
					}),
				width: source.width,
				height: source.height,
				pixelRatio: source.pixelRatio,
			},
			(frame) => {
				uploads.push(frame.width);
				return true;
			},
		);

		presenter.show(1);
		presenter.show(2);
		expect(queue).toHaveLength(2);
		// The answer to the newer request arrives first, the older one after it.
		queue[1]();
		queue[0]();

		expect(uploads).toHaveLength(1);
		expect(presenter.stats).toMatchObject({ presented: 1, droppedStale: 1 });
		expect({ delivered, released }).toEqual({ delivered: 2, released: 2 });

		// Every later frame is delivered, shown and released in turn.
		for (let index = 0; index < 20; index += 1) {
			presenter.show(index);
			queue.at(-1)!();
		}
		expect(presenter.stats.presented).toBe(21);
	});
});

describe("FramePresenter component", () => {
	test("uploads a 2x straight-alpha bitmap once mounted and again when the cursor moves", () => {
		const source = createSyntheticPreviewSource({ width: 64, height: 36 });
		const root = createTestRoot();
		const uploads: Array<{ width: number; height: number; bytes: number }> = [];
		const upload = root.renderer.setImagePixels.bind(root.renderer);
		root.renderer.setImagePixels = (...args: Parameters<typeof upload>) => {
			const [, width, height, pixels] = args;
			uploads.push({ width, height, bytes: pixels.length });
			upload(...args);
		};
		const [time, setTime] = createSignal(0);

		root.render(() => (
			<div>
				<FramePresenter source={source} time={time} />
			</div>
		));
		expect(uploads).toEqual([{ width: 128, height: 72, bytes: 128 * 72 * 4 }]);

		root.flushSync(() => setTime(1));
		expect(uploads).toHaveLength(2);
		root.unmount();
	});

	test("stops requesting frames after unmount", () => {
		const manual = createManualSource();
		const root = createTestRoot();
		const [time, setTime] = createSignal(0);

		root.render(() => (
			<div>
				<FramePresenter source={manual.source} time={time} />
			</div>
		));
		root.flushSync(() => setTime(1));
		expect(manual.requests).toEqual([0, 1]);

		root.unmount();
		setTime(2);
		expect(manual.requests).toEqual([0, 1]);
	});
});
