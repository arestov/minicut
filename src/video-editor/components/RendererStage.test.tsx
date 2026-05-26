import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
	PreviewFrame,
	PreviewStructure,
	RenderedClip,
} from "../read-model/previewReadModel";
import { PreviewMediaElementRegistry } from "./mediaElementRegistry";
import { RendererStage } from "./RendererStage";

const createClip = (overrides: Partial<RenderedClip> = {}): RenderedClip => ({
	id: "clip:1",
	resourceId: "resource:1",
	name: "Clip",
	color: "#2563eb",
	resourceName: "source.webm",
	resourceKind: "video",
	resourceUrl: "blob:source",
	mime: "video/webm",
	inPoint: 0,
	start: 0,
	opacity: 1,
	transform: { x: 0, y: 0, scale: 1, rotation: 0 },
	audio: { gain: 1, pan: 0 },
	filters: ["brightness(1.1)"],
	effects: [],
	text: null,
	...overrides,
});

const createFrame = (clips: RenderedClip[]): PreviewFrame => ({
	cursor: 0,
	renderedClips: clips,
	visualRenderedClips: clips.filter((clip) => clip.resourceKind !== "audio"),
	audioRenderedClips: clips.filter((clip) => clip.resourceKind === "audio"),
	activeClipNames: clips.map((clip) => clip.name),
});

const createStructure = (clips: RenderedClip[]): PreviewStructure => ({
	clipSources: clips.map((clip) => ({
		id: clip.id,
		resourceId: clip.resourceId,
		name: clip.name,
		color: clip.color,
		resourceName: clip.resourceName,
		resourceKind: clip.resourceKind,
		resourceUrl: clip.resourceUrl,
		mime: clip.mime,
		inPoint: clip.inPoint,
		filters: clip.filters,
		effects: clip.effects,
		text: clip.text,
		start: clip.start,
		duration: 5,
		fadeIn: 0,
		fadeOut: 0,
		opacity: { value: clip.opacity },
		transform: {
			x: { value: clip.transform.x },
			y: { value: clip.transform.y },
			scale: { value: clip.transform.scale },
			rotation: { value: clip.transform.rotation },
		},
		audio: clip.audio,
	})),
});

describe("RendererStage", () => {
	it("renders split compare before video from a snapshot without mounting duplicate videos", () => {
		const clips = [createClip()];
		render(
			<RendererStage
				structure={createStructure(clips)}
				frame={createFrame(clips)}
				isPlaying={false}
				mediaElementRegistry={new PreviewMediaElementRegistry()}
				compareMode="split"
			/>,
		);

		const renderer = screen.getByLabelText("Renderer stage");
		const compare = screen.getByLabelText("Split compare preview");

		expect(renderer.querySelectorAll("video")).toHaveLength(1);
		expect(compare).toBeInTheDocument();
		expect(
			compare.querySelector(
				".ve-renderer__compare-before canvas.ve-renderer__before-snapshot",
			),
		).not.toBeNull();
		expect(
			compare.querySelector(".ve-renderer__compare-before video"),
		).toBeNull();
	});
});
