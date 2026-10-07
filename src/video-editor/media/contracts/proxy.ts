import type { AssetLocation } from "./assets";

export interface ProxyRequest {
	requestId: string;
	source: { assetId: string } | AssetLocation;
	outputPath: string;
	/** Output height; width follows aspect ratio. Default 540. */
	height?: number;
	/** Keyframe every frame (all-intra) for scrubbing; default false = short GOP. */
	allIntra?: boolean;
	/** GOP length in frames when not all-intra. Default 12. */
	gopSize?: number;
	/** Omit the audio track (scrub proxies need none). Default false. */
	videoOnly?: boolean;
}
