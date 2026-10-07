import { describe, expect, it } from "vitest";
import type { PreviewClipSource } from "../../read-model/previewComps";
import type { ExportPlan } from "../../render/renderPlan";
import { type FfmpegPreviewPlanInput, planFfmpegExport } from "./ffmpegPlanner";
import { MediaError } from "./mediaError";

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	partial as unknown as PreviewClipSource;

const makePlan = (
	clipSources: PreviewClipSource[],
	overrides: Partial<ExportPlan> = {},
): ExportPlan => ({
	projectId: "p1",
	fps: 25,
	width: 320,
	height: 240,
	duration: 4,
	clipSources,
	...overrides,
});

const video = (id: string, start: number, duration: number, extra = {}) =>
	clip({
		id,
		resourceId: `res-${id}`,
		resourceKind: "video",
		start,
		duration,
		inPoint: 0,
		...extra,
	});

const audio = (id: string, start: number, duration: number, extra = {}) =>
	clip({
		id,
		resourceId: `res-${id}`,
		resourceKind: "audio",
		start,
		duration,
		inPoint: 0,
		...extra,
	});

const paths = (...ids: string[]) =>
	Object.fromEntries(ids.map((id) => [`res-${id}`, `C:/media/${id}.mp4`]));

const filterOf = (args: string[]): string =>
	args[args.indexOf("-filter_complex") + 1];

describe("planFfmpegExport", () => {
	it("sequences clips on a black base with trim, fps and size", () => {
		const result = planFfmpegExport({
			plan: makePlan([
				video("a", 0, 2, { inPoint: 1.5 }),
				video("b", 2, 2),
			]),
			range: { type: "project" },
			format: "webm",
			assetPaths: paths("a", "b"),
			outputPath: "out.part.webm",
		});
		const graph = filterOf(result.args);
		expect(graph).toContain("color=c=0x09090b:s=320x240:r=25:d=4");
		expect(graph).toContain("trim=start=1.5:duration=2");
		expect(graph).toContain("setpts=PTS+2/TB");
		expect(graph).toContain("scale=320:240:force_original_aspect_ratio=decrease");
		expect(graph).toContain("enable='between(t,2,4)'");
		expect(result.args).toEqual(
			expect.arrayContaining(["-frames:v", "100", "-c:v", "libvpx-vp9"]),
		);
		expect(result.args.at(-1)).toBe("out.part.webm");
		expect(result.frameCount).toBe(100);
		expect(result.hasAudio).toBe(false);
		expect(result.args).not.toContain("[aout]");
	});

	it("applies overrides for fps and size and rounds frames up", () => {
		const result = planFfmpegExport({
			plan: makePlan([video("a", 0, 1.01)], { duration: 1.01 }),
			range: { type: "project" },
			format: "mp4",
			assetPaths: paths("a"),
			outputPath: "o.mp4",
			fps: 30,
			width: 640,
			height: 360,
		});
		expect(result.frameCount).toBe(31);
		expect(result.width).toBe(640);
		expect(filterOf(result.args)).toContain("s=640x360:r=30");
		expect(result.args).toEqual(expect.arrayContaining(["-c:v", "libx264"]));
	});

	it("uses looped input for images", () => {
		const result = planFfmpegExport({
			plan: makePlan(
				[
					clip({
						id: "i",
						resourceId: "res-i",
						resourceKind: "image",
						start: 1,
						duration: 2,
					}),
				],
				{ duration: 3 },
			),
			range: { type: "project" },
			format: "webm",
			assetPaths: { "res-i": "C:/media/i.png" },
			outputPath: "o.webm",
		});
		const joined = result.args.join(" ");
		expect(joined).toContain("-loop 1 -framerate 25 -t 2 -i C:/media/i.png");
		expect(filterOf(result.args)).not.toContain("trim=");
	});

	it("mixes audio clips with gain, pan, delay and fixed duration", () => {
		const result = planFfmpegExport({
			plan: makePlan([
				video("v", 0, 4),
				audio("a1", 0, 4, { audio: { gain: 0.5, pan: 0 } }),
				audio("a2", 1, 2, { audio: { gain: 2, pan: 0.5 }, inPoint: 0.25 }),
			]),
			range: { type: "project" },
			format: "webm",
			assetPaths: paths("v", "a1", "a2"),
			outputPath: "o.webm",
		});
		const graph = filterOf(result.args);
		expect(result.hasAudio).toBe(true);
		expect(graph).toContain("pan=stereo|c0=0.5*c0|c1=0.5*c1");
		// gain clamps to 1.5; pan 0.5 attenuates the left channel
		expect(graph).toContain("pan=stereo|c0=0.75*c0|c1=1.5*c1");
		expect(graph).toContain("adelay=1000:all=1");
		expect(graph).toContain("atrim=start=0.25:duration=2");
		expect(graph).toContain("amix=inputs=2:normalize=0");
		expect(graph).toContain("apad=whole_dur=4,atrim=duration=4[aout]");
		expect(result.args).toEqual(
			expect.arrayContaining(["-map", "[aout]", "-c:a", "libopus"]),
		);
	});

	it("restricts to a clip range with its linked audio and re-bases time", () => {
		const result = planFfmpegExport({
			plan: makePlan([
				video("a", 0, 2),
				video("b", 2, 2, { inPoint: 3 }),
				audio("b-aud", 2, 2, { resourceId: "res-b" }),
			]),
			range: { type: "clip", clipId: "b" },
			format: "webm",
			assetPaths: paths("a", "b"),
			outputPath: "o.webm",
		});
		expect(result.clipIds).toEqual(["b", "b-aud"]);
		expect(result.durationSeconds).toBe(2);
		const graph = filterOf(result.args);
		expect(graph).toContain("trim=start=3:duration=2");
		expect(graph).toContain("setpts=PTS+0/TB");
		expect(graph).toContain("d=2");
	});

	it("trims clips that extend past a range", () => {
		const result = planFfmpegExport({
			plan: makePlan([video("a", 0, 10, { inPoint: 5 })], { duration: 10 }),
			range: { type: "project" },
			format: "webm",
			assetPaths: paths("a"),
			outputPath: "o.webm",
			fps: 10,
		});
		expect(result.frameCount).toBe(100);
	});

	it.each([
		[
			"effect",
			{ effects: [{ kind: "color", name: "x", enabled: true, amount: 1 }] },
		],
		["transform", { transform: { x: { value: 10 } } }],
		["opacity", { opacity: { value: 0.5 } }],
		["fade", { fadeIn: 0.5 }],
		[
			"text",
			{
				resourceKind: "text",
				text: { content: "hi", style: {}, box: { width: 1, height: 1 } },
			},
		],
	])("rejects unsupported %s with a capability error", (operation, extra) => {
		let error: unknown;
		try {
			planFfmpegExport({
				plan: makePlan([video("a", 0, 2, extra)]),
				range: { type: "project" },
				format: "webm",
				assetPaths: paths("a"),
				outputPath: "o.webm",
			});
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(MediaError);
		const mediaError = error as MediaError;
		expect(mediaError.code).toBe("unsupported-operation");
		expect(mediaError.details?.operations).toContain(operation);
	});

	it("ignores disabled effects", () => {
		expect(() =>
			planFfmpegExport({
				plan: makePlan([
					video("a", 0, 2, {
						effects: [{ kind: "color", name: "x", enabled: false }],
					}),
				]),
				range: { type: "project" },
				format: "webm",
				assetPaths: paths("a"),
				outputPath: "o.webm",
			}),
		).not.toThrow();
	});

	it.each([
		["missing asset", { assetPaths: {} }, "asset-not-found"],
		["odd size", { width: 321 }, "invalid-request"],
		["bad fps", { fps: 0 }, "invalid-request"],
		["unknown clip range", { range: { type: "clip", clipId: "zzz" } }, "invalid-request"],
		["unknown format", { format: "avi" }, "unsupported-format"],
	])("fails on %s", (_name, override, code) => {
		expect(() =>
			planFfmpegExport({
				plan: makePlan([video("a", 0, 2)]),
				range: { type: "project" },
				format: "webm",
				assetPaths: paths("a"),
				outputPath: "o.webm",
				...(override as object),
			} as Parameters<typeof planFfmpegExport>[0]),
		).toThrowError(expect.objectContaining({ code }));
	});
});

describe("planFfmpegExport mono audio", () => {
	it("duplicates mono sources to both channels at full level", () => {
		const result = planFfmpegExport({
			plan: makePlan([audio("a1", 0, 2)], { duration: 2 }),
			range: { type: "project" },
			format: "webm",
			assetPaths: paths("a1"),
			outputPath: "o.webm",
			audioChannels: { "res-a1": 1 },
		});
		const graph = filterOf(result.args);
		expect(graph).toContain("channel_layouts=mono");
		expect(graph).toContain("pan=stereo|c0=1*c0|c1=1*c0");
	});
});

describe("planFfmpegExport silent audio resources", () => {
	it("treats an audio clip of a resource without an audio stream as silence", () => {
		const result = planFfmpegExport({
			plan: makePlan([video("v", 0, 2), audio("a1", 0, 2)], { duration: 2 }),
			range: { type: "project" },
			format: "webm",
			assetPaths: paths("v", "a1"),
			outputPath: "o.webm",
			silentAudioResources: ["res-a1"],
		});
		expect(result.hasAudio).toBe(false);
		expect(result.args).not.toContain("[aout]");
		expect(filterOf(result.args)).not.toContain("[1:a]");
	});
});

describe("planFfmpegExport preview mode", () => {
	const preview = (extra: Partial<FfmpegPreviewPlanInput> = {}) =>
		planFfmpegExport({
			plan: makePlan([
				video("a", 0, 2, { inPoint: 1.5 }),
				video("b", 2, 2),
				audio("t", 0, 4),
			]),
			range: { type: "project" },
			preview: { start: 2.5, duration: 0.02 },
			assetPaths: paths("a", "b", "t"),
			width: 160,
			height: 120,
			...extra,
		});

	it("seeks video inputs, drops audio and writes raw rgba to stdout", () => {
		const result = preview();
		const joined = result.args.join(" ");
		expect(joined).toContain("-ss 0.5 -i C:/media/b.mp4");
		expect(filterOf(result.args)).toContain("trim=start=0:duration=0.02");
		expect(result.hasAudio).toBe(false);
		expect(result.clipIds).toEqual(["b", "t"]);
		expect(result.args).not.toContain("-progress");
		expect(result.args.slice(-5)).toEqual(["-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"]);
		expect(result.args).toEqual(expect.arrayContaining(["-frames:v", "1"]));
	});

	it("with a source fps seeks near the first source frame at or after the in-point", () => {
		const result = preview({
			plan: makePlan([video("b", 0, 4, { inPoint: 0.7 })]),
			preview: { start: 1, duration: 0.02 },
			assetPaths: paths("b"),
			sourceFps: { "res-b": 25 },
		});
		// f0 = 0.72; 25 output slots passed -> origin 1.72, 0.4s of
		// look-behind -> first 1.32, seek 0.5s earlier at 0.82.
		expect(result.args.join(" ")).toContain("-ss 0.82 -i C:/media/b.mp4");
		const graph = filterOf(result.args);
		expect(graph).toContain("trim=start=0.5:end=0.92,setpts=PTS-0.9/TB");
		expect(graph).toContain("fps=25:start_time=0");
		expect(graph).not.toContain("PTS-STARTPTS");
	});

	it("keeps the export capability errors", () => {
		expect(() =>
			preview({
				plan: makePlan([video("a", 0, 4, { opacity: { value: 0.5 } })]),
			}),
		).toThrowError(expect.objectContaining({ code: "unsupported-operation" }));
	});

	it("still requires a format and an output path for export", () => {
		const base = {
			plan: makePlan([video("a", 0, 4)]),
			range: { type: "project" as const },
			assetPaths: paths("a"),
		};
		expect(() =>
			planFfmpegExport({ ...base, outputPath: "o.webm" } as never),
		).toThrowError(expect.objectContaining({ code: "unsupported-format" }));
		expect(() =>
			planFfmpegExport({ ...base, format: "webm" } as never),
		).toThrowError(expect.objectContaining({ code: "invalid-request" }));
	});
});
