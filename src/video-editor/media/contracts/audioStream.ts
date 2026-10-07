import type { ExportPlan } from "../../render/renderPlan";
import type { AssetLocations } from "./assets";

/**
 * Everything needed to mix the timeline audio, resolved by the host before
 * playback: the render plan, files by resource id and what probing found out
 * about the audio resources. The stream reads nothing else.
 */
export interface AudioMixDescriptor {
	plan: ExportPlan;
	/** Resolved file locations by clip resourceId (audio clips only are read). */
	assets: AssetLocations;
	/** Channel count by audio resourceId; mono sources are duplicated to both channels. */
	audioChannels: Record<string, number>;
	/** Audio resources whose file has no audio stream (they contribute silence). */
	silentAudioResources: readonly string[];
}

export interface AudioMixStreamRequest extends AudioMixDescriptor {
	/** Timeline time of the first sample. */
	startSeconds: number;
	/** Stream length; default until the end of the plan. */
	durationSeconds?: number;
}
