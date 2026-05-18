import { describe, expect, it } from "vitest";
import {
	reduceClipUpdateOpacityAction,
	reduceTimelineMoveByAction,
	reduceTimelineSplitAtAction,
	reduceTimelineTrimAction,
} from "../../models/Clip/actions";
import { createDeterministicRandom } from "../test/projectGraphAssertions";

const isTenthsAligned = (value: number): boolean =>
	Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;

describe("clip action reducer contracts", () => {
	it("moveBy keeps the clip start normalized and non-negative", () => {
		const random = createDeterministicRandom(17);
		const deltas = [-1.7, -1.1, -0.8, -0.4, 0.4, 0.8, 1.1, 1.7];

		for (let index = 0; index < 20; index += 1) {
			const start = Math.round(random() * 40) / 10;
			const delta = deltas[Math.floor(random() * deltas.length)] ?? 0.4;
			const patch = reduceTimelineMoveByAction({ delta }, { start });

			expect(patch).not.toBeNull();
			if (!patch) {
				throw new Error("Expected patch");
			}
			expect(patch.start).toBeGreaterThanOrEqual(0);
			expect(isTenthsAligned(patch.start ?? 0)).toBe(true);
		}

		expect(reduceTimelineMoveByAction({ delta: -1.2 }, { start: 0.2 })).toEqual(
			{ start: 0 },
		);
	});

	it("trim keeps the clip end stable on start-edge edits and floors duration at 0.5", () => {
		const random = createDeterministicRandom(29);
		const deltas = [-0.9, -0.6, -0.3, 0.3, 0.6, 0.9];

		for (let index = 0; index < 20; index += 1) {
			const start = Math.round((1 + random() * 6) * 10) / 10;
			const duration = Math.round((1 + random() * 4) * 10) / 10;
			const inPoint = Math.round(random() * 3 * 10) / 10;
			const delta = deltas[Math.floor(random() * deltas.length)] ?? 0.3;
			const attrs = { start, in: inPoint, duration };
			const patch = reduceTimelineTrimAction({ edge: "start", delta }, attrs);

			expect(patch).not.toBeNull();
			if (!patch) {
				throw new Error("Expected patch");
			}
			const nextStart = patch.start ?? attrs.start;
			const nextDuration = patch.duration ?? attrs.duration;
			const nextIn = patch.in ?? attrs.in;

			expect(nextStart).toBeGreaterThanOrEqual(0);
			expect(nextDuration).toBeGreaterThanOrEqual(0.5);
			expect(isTenthsAligned(nextStart)).toBe(true);
			expect(isTenthsAligned(nextIn)).toBe(true);
			expect(isTenthsAligned(nextDuration)).toBe(true);
			expect(nextStart + nextDuration).toBeCloseTo(
				attrs.start + attrs.duration,
				6,
			);
			expect(nextIn - attrs.in).toBeCloseTo(nextStart - attrs.start, 6);
		}

		expect(
			reduceTimelineTrimAction(
				{ edge: "end", delta: -10 },
				{ start: 0, in: 0, duration: 1 },
			),
		).toEqual({ duration: 0.5 });
	});

	it("splitAt only accepts in-bounds split points", () => {
		const attrs = { start: 1.5, duration: 2.5 };
		expect(reduceTimelineSplitAtAction({ time: 1.4 }, attrs)).toBeNull();
		expect(reduceTimelineSplitAtAction({ time: 4.0 }, attrs)).toBeNull();
		expect(reduceTimelineSplitAtAction({ time: 2.5 }, attrs)).toEqual({
			duration: 1,
		});
	});

	it("opacity update rounds to tenths and rejects invalid input", () => {
		expect(reduceClipUpdateOpacityAction({ opacityPercent: 87.4 })).toEqual({
			opacity: { value: 0.9 },
		});
		expect(reduceClipUpdateOpacityAction(12.2)).toEqual({
			opacity: { value: 0.1 },
		});
		expect(reduceClipUpdateOpacityAction(Number.NaN)).toBeNull();
	});
});
