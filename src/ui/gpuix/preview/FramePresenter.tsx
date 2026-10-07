import { createEffect, onCleanup, onMount } from "solid-js";
import { createFramePresenter } from "./presenterController";
import type { PreviewFrameSource } from "./frameSource";

/** The part of the native img host element this component uses. */
type PixelTarget = {
	setImagePixels(width: number, height: number, pixels: Uint8Array): void;
	/** Set once the element is inserted into a GPUIX root. */
	root: { mutations: { flushMutations(): void } } | null;
};

/**
 * Paints the frames of a source into a native <img>. The bitmap is uploaded
 * at the source's pixel ratio times the layout box size, so the box stays at
 * logical size and the image is sharp on a 2x display. The shown time is the
 * `time` accessor (the model cursor); stale frames are dropped.
 */
export const FramePresenter = (props: {
	source: PreviewFrameSource;
	/** Timeline time of the frame to show, in seconds. */
	time: () => number;
	testId?: string;
}) => {
	let image: PixelTarget | undefined;

	const presenter = createFramePresenter(props.source, (frame) => {
		if (!image?.root) return false;
		// The native element only exists once the root applied the queued
		// mutations; flush them explicitly before addressing it.
		image.root.mutations.flushMutations();
		image.setImagePixels(frame.width, frame.height, frame.pixels);
		return true;
	});
	onCleanup(() => presenter.dispose());

	createEffect(() => {
		presenter.show(props.time());
	});
	// A frame that arrived before the element was attached was dropped:
	// ask again once it is mounted.
	onMount(() => presenter.targetReady());

	return (
		<img
			ref={(element) => {
				image = element;
			}}
			testId={props.testId}
			objectFit="contain"
			style={{
				width: props.source.width,
				height: props.source.height,
			}}
		/>
	);
};
