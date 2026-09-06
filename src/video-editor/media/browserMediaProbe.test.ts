import { describe, expect, it, vi } from "vitest";
import { probeBrowserMediaFile } from "./browserMediaProbe";

const platform = (metadata: { duration: number; width?: number; height?: number }) => {
	const target = new EventTarget() as HTMLVideoElement;
	Object.assign(target, { duration: metadata.duration, videoWidth: metadata.width ?? 0, videoHeight: metadata.height ?? 0, preload: "", src: "", load: vi.fn(), removeAttribute: vi.fn() });
	const revokeObjectURL = vi.fn();
	return { value: { createElement: vi.fn(() => target), createObjectURL: vi.fn(() => "blob:probe"), revokeObjectURL }, target, revokeObjectURL };
};

describe("browser media metadata probe", () => {
	it("reports guaranteed video metadata and represents unavailable fields as unknown", async () => {
		const fake = platform({ duration: 12.5, width: 1920, height: 1080 });
		const pending = probeBrowserMediaFile(new File(["x"], "x.mp4", { type: "video/mp4" }), undefined, fake.value);
		fake.target.dispatchEvent(new Event("loadedmetadata"));
		expect(await pending).toEqual({ kind: "video", duration: 12.5, frameRate: null, timebase: null, width: 1920, height: 1080, audioChannels: null, audioSampleRate: null, streams: { videoStreams: 1, audioStreams: null } });
		expect(fake.revokeObjectURL).toHaveBeenCalledWith("blob:probe");
	});

	it("cancels and revokes the temporary URL", async () => {
		const fake = platform({ duration: 1 }); const controller = new AbortController();
		const pending = probeBrowserMediaFile(new File(["x"], "x.mp4", { type: "video/mp4" }), controller.signal, fake.value); controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(fake.revokeObjectURL).toHaveBeenCalled();
	});
});
