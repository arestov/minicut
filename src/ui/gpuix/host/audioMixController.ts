import type { AudioMixDescriptor } from "../../../video-editor/media/contracts/audioStream";
import type { AssetResolver } from "../../../video-editor/media/contracts/assets";
import type { ProbeResult } from "../../../video-editor/media/contracts/probe";
import type { PreviewClipSource } from "../../../video-editor/read-model/previewComps";
import { normalizeExportPlan } from "../../../video-editor/render/renderPlan";
import type { PreviewPlanInput } from "../preview/nodePreviewController";
import { localAssetIdOf } from "../../../video-editor/hosts/desktop/localAssetSource";

export type AudioMixController = {
	/** Latest plan inputs of the active project (declared model attrs); null when there is none. */
	updatePlan(input: PreviewPlanInput | null): void;
	/** Re-resolves files for the current plan (the asset registry or index changed). */
	refreshAssets(): void;
	/** Mix descriptor of the resolved plan, or null when the timeline has no playable audio. */
	current(): AudioMixDescriptor | null;
	/** Resolves when the latest plan has been resolved (test and shutdown aid). */
	idle(): Promise<void>;
	/** Called when `current()` changed to a different mix. Returns unsubscribe. */
	subscribe(listener: () => void): () => void;
	dispose(): void;
};

export type AudioMixControllerOptions = {
	assets: AssetResolver;
	probe(filePath: string): Promise<ProbeResult>;
};

/**
 * Resolves the audio part of the model's plan inputs to files and probed
 * channel layouts, once per plan revision, so that the realtime stream reads
 * only this descriptor (no model or registry lookups while playing). Clips
 * whose file is missing are left out (silence; the preview already reports
 * the missing source). Edits to video clips do not change the audio mix.
 */
export const createAudioMixController = (
	options: AudioMixControllerOptions,
): AudioMixController => {
	const listeners = new Set<() => void>();
	let input: PreviewPlanInput | null = null;
	let descriptor: AudioMixDescriptor | null = null;
	let signature = "";
	let buildToken = 0;
	let disposed = false;
	let latestBuild: Promise<void> = Promise.resolve();
	const channelCache = new Map<string, Promise<number | null>>();

	const channelsOf = (filePath: string): Promise<number | null> => {
		let cached = channelCache.get(filePath);
		if (!cached) {
			cached = options.probe(filePath).then(
				(probe) => probe.audio?.channels ?? null,
				() => null,
			);
			channelCache.set(filePath, cached);
		}
		return cached;
	};

	const build = async (current: PreviewPlanInput | null): Promise<void> => {
		const token = ++buildToken;
		let next: AudioMixDescriptor | null = null;
		if (current) {
			const assets: AudioMixDescriptor["assets"] = {};
			const audioChannels: Record<string, number> = {};
			const silent = new Set<string>();
			const clipSources: PreviewClipSource[] = [];
			const missing = new Set<string>();
			for (const source of current.clipSources) {
				const resourceId = source.resourceId;
				if (source.resourceKind !== "audio" || !resourceId) continue;
				if (missing.has(resourceId)) continue;
				if (!assets[resourceId]) {
					const assetId = localAssetIdOf(source.resourceSource);
					const resolution = assetId
						? await options.assets.resolve(assetId)
						: null;
					if (token !== buildToken) return;
					if (!resolution?.ok) {
						missing.add(resourceId);
						continue;
					}
					assets[resourceId] = { path: resolution.location.path };
					const channels = await channelsOf(resolution.location.path);
					if (token !== buildToken) return;
					if (channels === null) silent.add(resourceId);
					else audioChannels[resourceId] = channels;
				}
				clipSources.push(source);
			}
			const playable = clipSources.filter(
				(source) => !silent.has(source.resourceId ?? source.id),
			);
			if (playable.length > 0 && current.duration > 0) {
				next = {
					plan: normalizeExportPlan({
						projectId: current.projectId,
						fps: current.fps,
						width: current.width,
						height: current.height,
						duration: current.duration,
						clipSources,
					}),
					assets,
					audioChannels,
					silentAudioResources: [...silent],
				};
			}
		}
		const nextSignature = JSON.stringify(next);
		if (nextSignature === signature) return;
		signature = nextSignature;
		descriptor = next;
		if (!disposed) for (const listener of [...listeners]) listener();
	};

	return {
		updatePlan(next) {
			input = next;
			latestBuild = build(next);
		},
		refreshAssets() {
			channelCache.clear();
			latestBuild = build(input);
		},
		current: () => descriptor,
		idle: async () => {
			// A superseded build returns early; wait until the newest one is done.
			let seen: Promise<void>;
			do {
				seen = latestBuild;
				await seen;
			} while (seen !== latestBuild);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			buildToken += 1;
			listeners.clear();
		},
	};
};
