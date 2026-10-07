import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli";

describe("parseCliArgs", () => {
	it("parses probe and capabilities", () => {
		expect(parseCliArgs(["probe", "a.mp4"])).toEqual({
			command: "probe",
			file: "a.mp4",
		});
		expect(parseCliArgs(["capabilities"])).toEqual({ command: "capabilities" });
	});

	it("parses export options", () => {
		expect(
			parseCliArgs([
				"export", "--plan", "p.json", "--out", "o.mp4", "--format", "mp4",
				"--range", "clip:c1", "--fps", "30", "--width", "640", "--height", "360",
			]),
		).toMatchObject({
			command: "export",
			planPath: "p.json",
			outputPath: "o.mp4",
			format: "mp4",
			range: { type: "clip", clipId: "c1" },
			fps: 30,
			width: 640,
			height: 360,
		});
	});

	it("parses proxy flags", () => {
		expect(
			parseCliArgs(["proxy", "in.mp4", "--out", "o.mp4", "--all-intra", "--height", "360"]),
		).toMatchObject({ command: "proxy", file: "in.mp4", allIntra: true, height: 360 });
	});

	it.each([
		[[]],
		[["bogus"]],
		[["probe"]],
		[["export", "--plan", "p.json"]],
		[["export", "--plan", "p", "--out", "o", "--format", "avi"]],
		[["export", "--plan", "p", "--out", "o", "--fps", "abc"]],
		[["export", "--plan", "p", "--out", "o", "--range", "weird"]],
	])("rejects invalid args %j", (argv) => {
		expect(() => parseCliArgs(argv)).toThrowError(
			expect.objectContaining({ code: "invalid-request" }),
		);
	});
});
