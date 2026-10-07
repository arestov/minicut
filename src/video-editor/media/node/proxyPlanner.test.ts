import { describe, expect, it } from "vitest";
import { buildProxyArgs } from "./proxyPlanner";

const base = { inputPath: "in.mp4", outputPath: "out.mp4", hasAudio: true };

describe("buildProxyArgs", () => {
	it("uses a short GOP by default and caps height without upscaling", () => {
		const args = buildProxyArgs(base);
		expect(args).toEqual(expect.arrayContaining(["-g", "12", "-keyint_min", "12"]));
		expect(args).toContain("scale=-2:'min(540,ih)'");
		expect(args).toEqual(expect.arrayContaining(["-c:v", "libx264", "-c:a", "aac"]));
	});
	it("emits all-intra when requested", () => {
		expect(buildProxyArgs({ ...base, allIntra: true })).toEqual(
			expect.arrayContaining(["-g", "1"]),
		);
	});
	it("drops audio of a source that has it when videoOnly is set", () => {
		const args = buildProxyArgs({ ...base, videoOnly: true });
		expect(args).not.toContain("0:a:0");
		expect(args).not.toContain("aac");
		expect(args).toEqual(expect.arrayContaining(["-map", "0:v:0"]));
	});
	it("omits audio mapping for silent sources", () => {
		const args = buildProxyArgs({ ...base, hasAudio: false });
		expect(args).not.toContain("0:a:0");
		expect(args).not.toContain("aac");
	});
});
