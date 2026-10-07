import { type Accessor, createSignal } from "solid-js";
import type { AssetResolver } from "../../../video-editor/media/contracts/assets";
import type { ProbeResult } from "../../../video-editor/media/contracts/probe";
import {
	createPreviewProducer,
	type PreviewProducer,
	type PreviewProducerOptions,
	type PreviewProducerStats,
	type PreviewSource,
} from "../../../video-editor/media/node/preview/previewProducer";
import type { PreviewProxyCache } from "../../../video-editor/media/node/preview/previewProxyCache";
import type { PreviewClipSource } from "../../../video-editor/read-model/previewComps";
import {
	type ExportPlan,
	normalizeExportPlan,
} from "../../../video-editor/render/renderPlan";
import { contentKeyOf, localAssetIdOf } from "../../../video-editor/hosts/desktop/localAssetSource";
import type { PreviewFrame, PreviewFrameSource } from "./frameSource";
import {
	createNodePreviewFrameSource,
	type NodePreviewFrameSource,
} from "./nodePreviewFrameSource";
import {
	PREVIEW_HEIGHT,
	PREVIEW_PIXEL_RATIO,
	PREVIEW_WIDTH,
} from "./previewSize";

/** Plan inputs as the model exposes them (declared attrs); nothing is derived from them here. */
export type PreviewPlanInput = {
	projectId: string;
	fps: number;
	width: number;
	height: number;
	duration: number;
	clipSources: readonly PreviewClipSource[];
};

export type NodePreviewController = {
	/** Frame source for the presenter. */
	readonly source: PreviewFrameSource;
	/** Latest plan inputs of the active project; resolved to files asynchronously. */
	updatePlan(input: PreviewPlanInput | null): void;
	/** Re-resolves asset files for the current plan (asset index or registry changed). */
	refreshAssets(): void;
	/** Why the preview cannot show the whole timeline (missing source, unsupported edit), or null. */
	readonly notice: Accessor<string | null>;
	/** Resolves when no decoder process is running (test and shutdown aid). */
	idle(): Promise<void>;
	/** Producer counters (decodes from proxies, failures, ...). */
	stats(): PreviewProducerStats;
	dispose(): Promise<void>;
};

export type NodePreviewControllerOptions = {
	ffmpegPath: string;
	assets: AssetResolver;
	/** Scrub proxy cache; with it, video resources that have a content key decode from proxies once ready. */
	proxies?: PreviewProxyCache;
	probe(filePath: string): Promise<ProbeResult>;
	/** Test seam; defaults to the real producer. */
	createProducer?: (options: PreviewProducerOptions) => PreviewProducer;
	producerOptions?: Partial<PreviewProducerOptions>;
};

const BYTES_PER_PIXEL = 4;

const opaqueBlack = (width: number, height: number): Uint8Array => {
	const pixels = new Uint8Array(width * height * BYTES_PER_PIXEL);
	for (let index = 3; index < pixels.length; index += BYTES_PER_PIXEL) {
		pixels[index] = 255;
	}
	return pixels;
};

/**
 * Preview on the Node frame producer. It resolves the plan's resource ids to
 * local files (asset index + registry), probes each video's frame rate for
 * export-identical frame selection, and feeds the producer one `PreviewSource`
 * per plan/asset revision. Requests made before a source exists, or while the
 * plan changes, are re-issued for the latest time once the source is set.
 * An empty timeline shows a black frame (the producer cannot render a plan
 * without duration).
 */
export const createNodePreviewController = (
	options: NodePreviewControllerOptions,
): NodePreviewController => {
	const bitmapWidth = PREVIEW_WIDTH * PREVIEW_PIXEL_RATIO;
	const bitmapHeight = PREVIEW_HEIGHT * PREVIEW_PIXEL_RATIO;
	const producer = (options.createProducer ?? createPreviewProducer)({
		ffmpegPath: options.ffmpegPath,
		width: bitmapWidth,
		height: bitmapHeight,
		...(options.proxies ? { proxies: options.proxies } : {}),
		...options.producerOptions,
	});
	const [notice, setNotice] = createSignal<string | null>(null);

	let frameSink: ((frame: PreviewFrame) => void) | null = null;
	let sourceReady = false;
	let emptyTimeline = true;
	let latestTime: number | null = null;
	let input: PreviewPlanInput | null = null;
	let buildToken = 0;
	let lastSignature = "";
	let revision = 0;
	let disposed = false;
	let adapter: NodePreviewFrameSource | null = null;
	const fpsCache = new Map<string, Promise<number | null>>();

	const detachFrames = producer.onFrame((frame) => {
		frameSink?.(frame);
	});
	const detachErrors = producer.onError((error) => {
		setNotice(`Preview unavailable: ${error.message}`);
	});

	/** Sends one request (already numbered by the adapter) to whatever renders now. */
	const dispatchRequest = (time: number, generation: number): void => {
		if (disposed) return;
		if (emptyTimeline) {
			frameSink?.({
				width: bitmapWidth,
				height: bitmapHeight,
				pixels: opaqueBlack(bitmapWidth, bitmapHeight),
				generation,
				release() {},
			});
			return;
		}
		if (sourceReady) producer.request(time, generation);
	};

	/** The plan or its files changed: ask again for the latest time with a new generation. */
	const reissue = (): void => {
		if (!disposed && latestTime !== null) adapter?.request(latestTime);
	};

	const sourceFpsOf = (filePath: string): Promise<number | null> => {
		let cached = fpsCache.get(filePath);
		if (!cached) {
			cached = options.probe(filePath).then(
				(probe) => probe.video?.fps ?? probe.video?.nominalFps ?? null,
				() => null,
			);
			fpsCache.set(filePath, cached);
		}
		return cached;
	};

	const build = async (current: PreviewPlanInput | null): Promise<void> => {
		const token = ++buildToken;
		if (!current) {
			emptyTimeline = true;
			sourceReady = false;
			lastSignature = "";
			setNotice(null);
			reissue();
			return;
		}
		const assetPaths: Record<string, string> = {};
		const sourceFps: Record<string, number> = {};
		const contentKeys: Record<string, string> = {};
		const clipSources: PreviewClipSource[] = [];
		const unavailable = new Set<string>();
		for (const source of current.clipSources) {
			const resourceId = source.resourceId;
			if (source.resourceKind === "text" || !resourceId) {
				clipSources.push(source);
				continue;
			}
			if (unavailable.has(resourceId)) continue;
			if (!assetPaths[resourceId]) {
				const assetId = localAssetIdOf(source.resourceSource);
				const resolution = assetId ? await options.assets.resolve(assetId) : null;
				if (token !== buildToken) return;
				if (!resolution?.ok) {
					// Shown as black; the rest of the timeline still previews.
					unavailable.add(resourceId);
					continue;
				}
				assetPaths[resourceId] = resolution.location.path;
				const contentKey = contentKeyOf(source.resourceSource);
				if (contentKey && source.resourceKind === "video") {
					contentKeys[resourceId] = contentKey;
				}
				if (source.resourceKind === "video") {
					const fps = await sourceFpsOf(resolution.location.path);
					if (token !== buildToken) return;
					if (fps) sourceFps[resourceId] = fps;
				}
			}
			clipSources.push(source);
		}
		const plan: ExportPlan = normalizeExportPlan({
			projectId: current.projectId,
			fps: current.fps,
			width: current.width,
			height: current.height,
			duration: current.duration,
			clipSources,
		});
		const visible = clipSources.length > 0 && plan.duration > 0;
		const signature = JSON.stringify({ visible, plan, assetPaths, sourceFps, contentKeys });
		setNotice(
			unavailable.size > 0
				? `${unavailable.size} source file${unavailable.size === 1 ? " is" : "s are"} missing`
				: null,
		);
		if (signature === lastSignature) return;
		lastSignature = signature;
		emptyTimeline = !visible;
		if (visible) {
			revision += 1;
			const next: PreviewSource = {
				revision: `plan-${revision}`,
				plan,
				assetPaths,
				sourceFps,
				contentKeys,
			};
			producer.setSource(next);
			sourceReady = true;
		} else {
			sourceReady = false;
		}
		reissue();
	};

	adapter = createNodePreviewFrameSource({
		producer: {
			request(time, generation) {
				latestTime = time;
				dispatchRequest(time, generation);
			},
			onFrame(listener) {
				frameSink = listener;
				return () => {
					if (frameSink === listener) frameSink = null;
				};
			},
		},
		width: PREVIEW_WIDTH,
		height: PREVIEW_HEIGHT,
		pixelRatio: PREVIEW_PIXEL_RATIO,
	});

	return {
		source: adapter,
		updatePlan(next) {
			input = next;
			void build(next);
		},
		refreshAssets() {
			fpsCache.clear();
			lastSignature = "";
			void build(input);
		},
		notice,
		idle: () => producer.idle(),
		stats: () => producer.stats(),
		async dispose() {
			disposed = true;
			buildToken += 1;
			adapter?.dispose();
			detachFrames();
			detachErrors();
			await producer.dispose();
		},
	};
};
