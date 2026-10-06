import { createEffect } from "solid-js";
import type { SyntheticFrameSource } from "./syntheticFrameSource";

/** The part of the native img host element this component uses. */
type PixelTarget = {
	setImagePixels(width: number, height: number, pixels: Uint8Array): void;
	/** Set once the element is inserted into a GPUIX root. */
	root: { mutations: { flushMutations(): void } } | null;
};

/**
 * Paints synthetic frames into a native <img>. The bitmap is uploaded at
 * pixelRatio times the layout box size, so the box stays at logical size and
 * the image is sharp on a 2x display.
 */
export const SyntheticPreview = (props: {
	source: SyntheticFrameSource;
	/** Timeline time of the frame to show, in seconds. */
	time: () => number;
	testId?: string;
}) => {
	let image: PixelTarget | undefined;

	createEffect(() => {
		const frame = props.source.frameAt(props.time());
		if (!image?.root) return;
		// The native element only exists once the root applied the queued
		// mutations; flush them explicitly before addressing it.
		image.root.mutations.flushMutations();
		image.setImagePixels(frame.width, frame.height, frame.pixels);
	});

	return (
		<img
			ref={(element) => {
				image = element;
			}}
			testId={props.testId}
			objectFit="contain"
			style={{
				width: props.source.width / props.source.pixelRatio,
				height: props.source.height / props.source.pixelRatio,
			}}
		/>
	);
};
