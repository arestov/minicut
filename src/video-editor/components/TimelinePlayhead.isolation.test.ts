import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string =>
	readFileSync(resolve(process.cwd(), path), "utf8");

describe("timeline playhead isolation", () => {
	it("moves the contained overlay with a compositor transform", () => {
		const source = readSource("src/video-editor/components/TimelineView.tsx");
		const styles = readSource("src/video-editor/components/styles.css");
		const playheadComponent = source.slice(
			source.indexOf("const TimelinePlayhead"),
			source.indexOf("const TimelineHeader"),
		);
		const playheadCssStart = styles.indexOf(".ve-timeline-playhead {");
		const playheadCss = styles.slice(
			playheadCssStart,
			styles.indexOf(".ve-project-list", playheadCssStart),
		);

		expect(playheadComponent).toContain("usePlaybackSnapshot()");
		expect(playheadComponent).toContain("transform:");
		expect(playheadComponent).not.toContain("left:");
		expect(playheadCss).toContain("width: 12px");
		expect(playheadCss).toContain("contain: layout paint style");
		expect(playheadCss).toContain("will-change: transform");
	});

	it("does not subscribe the timeline track tree to playback frames", () => {
		const source = readSource("src/video-editor/components/TimelineView.tsx");
		const timelineTree = source.slice(source.indexOf("export const TimelineView"));

		expect(timelineTree).not.toContain("usePlaybackSnapshot(");
		expect(timelineTree).toContain("<ResolvedProjectTimeline");
	});
});
