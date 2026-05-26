import {
	evaluateFadeOpacity,
	evaluateKeyframedScalar,
	interpolateLinear,
} from "./timing";

describe("render timing helpers", () => {
	it("interpolates linearly between keyframes and clamps outside the range", () => {
		const scalar = {
			value: 0,
			keyframes: [
				{ time: 2, value: 10 },
				{ time: 0, value: 0 },
				{ time: 4, value: 20 },
			],
		};

		expect(interpolateLinear(10, 20, 0.25)).toBe(12.5);
		expect(evaluateKeyframedScalar(scalar, -1)).toBe(0);
		expect(evaluateKeyframedScalar(scalar, 1)).toBe(5);
		expect(evaluateKeyframedScalar(scalar, 3)).toBe(15);
		expect(evaluateKeyframedScalar(scalar, 5)).toBe(20);
	});

	it("falls back to scalar value when no usable keyframes exist", () => {
		expect(evaluateKeyframedScalar({ value: 0.7, keyframes: [] }, 10)).toBe(
			0.7,
		);
		expect(evaluateKeyframedScalar({ value: 0.4 }, 10)).toBe(0.4);
	});

	it("supports hold interpolation and resolved keyframe ids", () => {
		const resolved = new Map([
			["kf:0", { time: 0, value: 4, interpolation: "hold" as const }],
			["kf:1", { time: 2, value: 12 }],
		]);

		expect(
			evaluateKeyframedScalar(
				{ value: 0, keyframes: ["kf:0", "missing", "kf:1"] },
				1,
				(id) => resolved.get(id) ?? null,
			),
		).toBe(4);
		expect(
			evaluateKeyframedScalar(
				{ value: 0, keyframes: ["kf:0", "kf:1"] },
				2,
				(id) => resolved.get(id) ?? null,
			),
		).toBe(12);
	});

	it("evaluates fade in and fade out opacity over clip-local time", () => {
		expect(evaluateFadeOpacity(-0.01, 0, 4, 1, 1, 1)).toBe(0);
		expect(evaluateFadeOpacity(0, 0, 4, 1, 1, 1)).toBe(0);
		expect(evaluateFadeOpacity(0.5, 0, 4, 1, 1, 1)).toBeCloseTo(0.5, 6);
		expect(evaluateFadeOpacity(2, 0, 4, 1, 1, 1)).toBe(1);
		expect(evaluateFadeOpacity(3.5, 0, 4, 1, 1, 1)).toBeCloseTo(0.5, 6);
		expect(evaluateFadeOpacity(4, 0, 4, 1, 1, 1)).toBe(0);
	});
});
