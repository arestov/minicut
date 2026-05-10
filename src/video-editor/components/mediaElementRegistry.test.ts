import { describe, expect, it } from "vitest";
import { PreviewMediaElementRegistry } from "./mediaElementRegistry";

describe("PreviewMediaElementRegistry", () => {
	it("returns the topmost registered video by visual layer order", () => {
		const registry = new PreviewMediaElementRegistry();
		const bottomVideo = document.createElement("video");
		const topVideo = document.createElement("video");

		registry.set("bottom", "video", "bottom.mp4", bottomVideo, 0);
		registry.set("top", "video", "top.mp4", topVideo, 3);

		expect(registry.getTopmostVideo()).toBe(topVideo);
		expect(registry.getVideos()).toEqual([topVideo, bottomVideo]);
	});
});
