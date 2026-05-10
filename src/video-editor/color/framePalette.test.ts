import { describe, expect, it } from "vitest";
import {
	createPaletteFromHex,
	createPaletteFromRgbSamples,
} from "./framePalette";
import { getContrastRatio } from "./oklch";

describe("frame palette suggestions", () => {
	it("generates a readable text/background pair from RGB samples", () => {
		const palette = createPaletteFromRgbSamples([
			{ r: 18, g: 52, b: 86 },
			{ r: 42, g: 88, b: 132 },
			{ r: 220, g: 180, b: 92 },
		]);

		expect(palette).not.toBeNull();
		expect(palette?.textColor).toMatch(/^#[0-9a-f]{6}$/);
		expect(palette?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
		expect(palette?.accentColor).toMatch(/^#[0-9a-f]{6}$/);
		expect(
			getContrastRatio(palette!.textColor, palette!.backgroundColor),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("returns null when no pixels are available", () => {
		expect(createPaletteFromRgbSamples([])).toBeNull();
	});

	it("can derive a fallback palette from a clip color", () => {
		const palette = createPaletteFromHex("#2563eb");

		expect(palette).toMatchObject({
			textColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
			backgroundColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
		});
	});
});
