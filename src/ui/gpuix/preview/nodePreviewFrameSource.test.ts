import { describe, expect, test } from "bun:test";
import type { PreviewFrame } from "./frameSource";
import {
	createNodePreviewFrameSource,
	type NodePreviewProducer,
} from "./nodePreviewFrameSource";

/**
 * Producer double: records requests and emits frames only when the test calls
 * `emit`, never from inside `request`.
 */
const fakeProducer = () => {
	const requests: Array<{ time: number; generation: number }> = [];
	let sink: ((frame: PreviewFrame) => void) | null = null;
	let attachments = 0;
	const producer: NodePreviewProducer = {
		request: (time, generation) => {
			requests.push({ time, generation });
		},
		onFrame: (listener) => {
			sink = listener;
			attachments += 1;
			return () => {
				if (sink === listener) sink = null;
			};
		},
	};
	const released: number[] = [];
	const emit = (generation: number, id = generation) => {
		const frame: PreviewFrame = {
			width: 2,
			height: 2,
			pixels: new Uint8Array(16),
			generation,
			release: () => {
				released.push(id);
			},
		};
		if (!sink) {
			frame.release();
			return;
		}
		sink(frame);
	};
	return { producer, requests, emit, released, attachments: () => attachments };
};

describe("node preview frame source", () => {
	test("returns increasing generations and forwards them to the producer", () => {
		const fake = fakeProducer();
		const source = createNodePreviewFrameSource({
			producer: fake.producer,
			width: 480,
			height: 270,
			pixelRatio: 2,
		});

		expect(source.pixelRatio).toBe(2);
		const a = source.request(0.5);
		const b = source.request(1.5);

		expect(b).toBeGreaterThan(a);
		expect(fake.requests).toEqual([
			{ time: 0.5, generation: a },
			{ time: 1.5, generation: b },
		]);
	});

	test("delivers frames of the latest generation and releases stale ones", () => {
		const fake = fakeProducer();
		const source = createNodePreviewFrameSource({
			producer: fake.producer,
			width: 2,
			height: 2,
		});
		const received: number[] = [];
		source.subscribe((frame) => {
			received.push(frame.generation);
			frame.release();
		});

		const first = source.request(0);
		const second = source.request(1);
		fake.emit(first, 100);
		fake.emit(second, 200);

		expect(received).toEqual([second]);
		expect(fake.released).toEqual([100, 200]);
	});

	test("returns the buffer once after every subscriber released its frame", () => {
		const fake = fakeProducer();
		const source = createNodePreviewFrameSource({
			producer: fake.producer,
			width: 2,
			height: 2,
		});
		const held: PreviewFrame[] = [];
		source.subscribe((frame) => held.push(frame));
		source.subscribe((frame) => held.push(frame));
		const generation = source.request(0);
		fake.emit(generation, 7);

		expect(held).toHaveLength(2);
		held[0].release();
		held[0].release();
		expect(fake.released).toEqual([]);
		held[1].release();
		expect(fake.released).toEqual([7]);
		expect(fake.attachments()).toBe(1);
	});

	test("releases frames that arrive without subscribers or after dispose", () => {
		const fake = fakeProducer();
		const source = createNodePreviewFrameSource({
			producer: fake.producer,
			width: 2,
			height: 2,
		});
		const unsubscribe = source.subscribe(() => {
			throw new Error("must not be called");
		});
		unsubscribe();
		const generation = source.request(0);
		fake.emit(generation, 1);

		source.subscribe(() => undefined);
		source.dispose();
		fake.emit(generation, 2);

		expect(fake.released).toEqual([1, 2]);
		expect(source.request(3)).toBeGreaterThan(generation);
		expect(fake.requests).toHaveLength(1);
	});

	test("a throwing listener still releases its share and the others get the frame", () => {
		const fake = fakeProducer();
		const source = createNodePreviewFrameSource({
			producer: fake.producer,
			width: 2,
			height: 2,
		});
		const held: PreviewFrame[] = [];
		source.subscribe(() => {
			throw new Error("listener failed");
		});
		source.subscribe((frame) => held.push(frame));
		const generation = source.request(0);

		expect(() => fake.emit(generation, 9)).toThrow("listener failed");
		expect(held).toHaveLength(1);
		expect(fake.released).toEqual([]);
		held[0].release();
		expect(fake.released).toEqual([9]);
	});
});
