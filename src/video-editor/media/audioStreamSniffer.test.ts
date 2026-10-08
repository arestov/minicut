import { describe, expect, it } from "vitest";
import { byteRangeSourceFromBlob, sniffAudioStreams } from "./audioStreamSniffer";
import { probeBrowserMediaFile } from "./browserMediaProbe";

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, ...payload: number[][]): number[] => {
	const body = payload.flat();
	return [...u32(8 + body.length), ...text(type), ...body];
};
const trak = (handler: string) => box("trak", box("mdia", box("hdlr", [0, 0, 0, 0], [0, 0, 0, 0], text(handler), new Array(12).fill(0))));
const mp4 = (handlers: string[], moovFirst: boolean) => {
	const moov = box("moov", ...handlers.map(trak));
	const mdat = box("mdat", new Array(64).fill(7));
	return new Uint8Array([...box("ftyp", text("isom"), u32(0)), ...(moovFirst ? [...moov, ...mdat] : [...mdat, ...moov])]);
};
const source = (bytes: Uint8Array) => ({ size: bytes.length, readRange: async (s: number, e: number) => bytes.slice(s, e) });

describe("audio stream sniffer on synthetic containers", () => {
	it("counts soun handlers wherever moov sits", async () => {
		expect((await sniffAudioStreams(source(mp4(["vide"], true))))?.audioStreams).toBe(0);
		expect((await sniffAudioStreams(source(mp4(["vide", "soun"], false))))?.audioStreams).toBe(1);
		expect((await sniffAudioStreams(source(mp4(["soun", "vide", "soun"], true))))?.audioStreams).toBe(2);
	});

	it("handles a 64-bit mdat size and a size-0 trailing box", async () => {
		const moov = box("moov", trak("vide"));
		const big = [...u32(1), ...text("mdat"), 0, 0, 0, 0, ...u32(16 + 8), ...new Array(8).fill(1)];
		const bytes = new Uint8Array([...box("ftyp", text("isom"), u32(0)), ...big, ...moov]);
		expect((await sniffAudioStreams(source(bytes)))?.audioStreams).toBe(0);
		const open = new Uint8Array([...box("ftyp", text("isom"), u32(0)), ...u32(0), ...text("moov"), ...trak("soun")]);
		expect((await sniffAudioStreams(source(open)))?.audioStreams).toBe(1);
	});

	it("returns null without a track list", async () => {
		const bytes = new Uint8Array([...box("ftyp", text("isom"), u32(0)), ...box("mdat", new Array(64).fill(7))]);
		expect(await sniffAudioStreams(source(bytes))).toBeNull();
	});

	it("reads a Blob through slice", async () => {
		const blob = new Blob([mp4(["vide", "soun"], true)]);
		expect((await sniffAudioStreams(byteRangeSourceFromBlob(blob)))?.audioStreams).toBe(1);
	});

	it("fills the browser probe streams for a silent video", async () => {
		const target = new EventTarget() as HTMLVideoElement;
		Object.assign(target, { duration: 1, videoWidth: 2, videoHeight: 2, preload: "", src: "", load: () => undefined, removeAttribute: () => undefined });
		const platform = { createElement: () => target, createObjectURL: () => "blob:p", revokeObjectURL: () => undefined };
		const pending = probeBrowserMediaFile(new File([mp4(["vide"], true)], "s.mp4", { type: "video/mp4" }), undefined, platform);
		target.dispatchEvent(new Event("loadedmetadata"));
		expect((await pending).streams).toEqual({ videoStreams: 1, audioStreams: 0 });
	});
});
