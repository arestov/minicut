import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRoot } from "solid-js";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { resolveMediaBinaries } from "../../../video-editor/media/node/binaries";
import { createPreviewProducer } from "../../../video-editor/media/node/preview/previewProducer";
import { resetParityDirectory, writeManifest } from "../../../../tests/parity/artifacts";
import { encodeRgbaPng } from "../../../../tests/parity/rgbaPng";
import {
	PARITY_FILES,
	PARITY_STEPS,
	clipNodeIdFromDump,
	containedRect,
	isSnapshotComplete,
	resourceNodeIdFromDump,
	snapshotFromGraphDump,
	type ParityClipRef,
	type ParityFrameArtifact,
	type ParityManifest,
	type ParitySnapshot,
} from "../../../../tests/parity/sharedScenario";
import { waitForAttr } from "../fixtures/scopeWait";
import { openRealHostFixture, type RealHostFixture } from "../host/realHostFixture";
import { createImportFromDialog } from "../host/nativeDialogs";
import { createPlaybackExecutor } from "../host/playbackExecutor";
import type { PreviewFrame } from "../preview/frameSource";
import { createNodePreviewController, type PreviewPlanInput } from "../preview/nodePreviewController";
import { PREVIEW_HEIGHT, PREVIEW_PIXEL_RATIO, PREVIEW_WIDTH } from "../preview/previewSize";
import { gpuixFixture } from "../test/mediaFixtures";

/**
 * Desktop half of the web/desktop parity suite: the shared scenario on the
 * real host composition (worker + LevelDB, asset registry, ffmpeg media
 * service, GPUIX executors; no window, audio off). Writes its artifacts to
 * tmp/parity/desktop; `tests/parity/webDesktopParity.compare.test.ts`
 * compares them with the web run. Mutations and reads are separate steps:
 * every action is dispatched, then the graph is read once the page has the update.
 */
let host: RealHostFixture | null = null;
// The step the run is waiting on, printed when the test ends without reaching it (the test timeout is the only limit).
let pendingWait: string | null = null;
afterEach(async () => {
	if (pendingWait) console.error(`[parity] the page graph never reached the state after: ${pendingWait}`);
	pendingWait = null;
	await host?.close();
	host = null;
});

const effectShape = defineShape({ attrs: ["name", "kind", "enabled", "params"] });

const rootShape = defineShape({
	attrs: ["cursor", "isPlaying", "selectedEntityId", "activeInspectorTab", "previewStructure", "exportProgress"],
	one: {
		activeProject: defineShape({
			attrs: ["fps", "width", "height", "duration", "importProgress"],
			many: {
				resources: defineShape({ attrs: ["name", "kind", "duration"] }),
				tracks: defineShape({
					attrs: ["name", "kind"],
					many: {
						clips: defineShape({
							attrs: ["name", "mediaKind", "start", "in", "duration", "fadeIn", "fadeOut", "audio", "opacity", "color", "transform", "$meta$rels$colorCorrectionEffects$exists"],
							one: { resource: defineShape({ attrs: ["name"] }) },
       many: { effects: effectShape, colorCorrectionEffects: effectShape },
						}),
					},
				}),
			},
		}),
	},
});

const SCENARIO_TIMEOUT_MS = 240_000;

test("runs the shared scenario on the real desktop host", async () => {
	const startedAt = performance.now();
	const artifacts = resetParityDirectory("desktop");
	host = await openRealHostFixture();
	const h = host;
	const page = h.page;

	// Files get the scenario's names so resources and clips are named like on the web.
	const inputDir = path.join(h.profileDir, "scenario-input");
	mkdirSync(inputDir);
	const inputPath = (name: string) => path.join(inputDir, name);
	for (const file of PARITY_FILES) copyFileSync(await gpuixFixture(file.fixture), inputPath(file.name));

	const importer = h.attachImport();
	h.attachExport();
	const playback = createPlaybackExecutor({ page });
	const stopPlayback = page.subscribeRuntimeTaskRequests?.("$fx_applyPlaybackRun", (payload) => {
		playback.handleRequest(payload);
	});
	expect(stopPlayback).toBeDefined();

	const root = await h.driver.root();
	page.mountShape(root, rootShape);
	const project = await h.driver.waitOne(root, "activeProject");
	const dump = () => page.debugDumpGraph();

	// Updates reach the page after the action settled, so reads wait for them: the helper
	// subscribes to every scope the snapshot is built from (the accessors components use)
	// and resolves when the graph satisfies `accept`.
	const ROOT_ATTRS = ["cursor", "isPlaying", "selectedEntityId", "activeInspectorTab"] as const;
	const PROJECT_ATTRS = ["fps", "width", "height"] as const;
	const EFFECT_ATTRS = ["name", "kind", "enabled", "params"] as const;
	const CLIP_ATTRS = ["name", "mediaKind", "start", "in", "duration", "fadeIn", "fadeOut", "audio", "opacity", "color", "transform", "$meta$rels$colorCorrectionEffects$exists"] as const;
	const waitForSnapshot = (accept: (snapshot: ParitySnapshot) => boolean, what: string): Promise<ParitySnapshot> =>
		new Promise<ParitySnapshot>((resolve) => {
			const subscriptions = new Map<string, () => void>();
			let finished = false;
			pendingWait = what;
			const finish = (complete: () => void) => {
				finished = true;
				pendingWait = null;
				for (const stop of subscriptions.values()) stop();
				subscriptions.clear();
				complete();
			};
			const reconcile = () => {
				const wanted = new Map<string, () => () => void>();
				const attrs = (key: string, scope: ReactSyncScopeHandle, names: readonly string[]) =>
					wanted.set(`attrs:${key}`, () => page.subscribeAttrs(scope, names, onChange));
				const many = (key: string, scope: ReactSyncScopeHandle, rel: string) =>
					wanted.set(`many:${key}:${rel}`, () => page.subscribeMany(scope, rel, onChange));
				attrs("root", root, ROOT_ATTRS);
				attrs(project._nodeId ?? "project", project, PROJECT_ATTRS);
				many("project", project, "resources");
				many("project", project, "tracks");
				for (const resource of page.readMany(project, "resources")) {
					attrs(resource._nodeId ?? "resource", resource, ["name", "kind", "duration"]);
				}
				for (const track of page.readMany(project, "tracks")) {
					attrs(track._nodeId ?? "track", track, ["name", "kind"]);
					many(track._nodeId ?? "track", track, "clips");
					for (const clip of page.readMany(track, "clips")) {
						attrs(clip._nodeId ?? "clip", clip, CLIP_ATTRS);
						wanted.set(`one:${clip._nodeId}:resource`, () => page.subscribeOne(clip, "resource", onChange));
      for (const rel of ["effects", "colorCorrectionEffects"]) {
       many(clip._nodeId, clip, rel);
       for (const effect of page.readMany(clip, rel)) attrs(effect._nodeId, effect, EFFECT_ATTRS);
      }
					}
				}
				for (const [key, stop] of subscriptions) {
					if (!wanted.has(key)) {
						stop();
						subscriptions.delete(key);
					}
				}
				for (const [key, subscribe] of wanted) {
					if (!subscriptions.has(key)) subscriptions.set(key, subscribe());
				}
			};
			const check = () => {
				const current = snapshotFromGraphDump(dump());
				if (isSnapshotComplete(current) && accept(current)) finish(() => resolve(current));
			};
			const onChange = () => {
				if (finished) return;
				reconcile();
				check();
			};
			reconcile();
			check();
		});
	const hashOf = (snapshot: ParitySnapshot) => JSON.stringify(snapshot);
	/** The state after an action: complete and different from the state before it. */
	const afterAction = async (run: () => Promise<void>, what: string): Promise<ParitySnapshot> => {
		const before = hashOf(snapshotFromGraphDump(dump()));
		await run();
		return waitForSnapshot((current) => hashOf(current) !== before, what);
	};

	const clipScope = (ref: ParityClipRef): ReactSyncScopeHandle => {
		const nodeId = clipNodeIdFromDump(dump(), ref);
		if (!nodeId) throw new Error(`No clip ${JSON.stringify(ref)}`);
		for (const track of page.readMany(project, "tracks")) {
			const found = page.readMany(track, "clips").find((clip) => clip._nodeId === nodeId);
			if (found) return found;
		}
		throw new Error(`Clip ${nodeId} is not mounted`);
	};

	const checkpoints: Record<string, ParitySnapshot> = {};
	const frames: ParityFrameArtifact[] = [];
	const exports: ParityManifest["exports"] = [];
	const ffmpegPath = resolveMediaBinaries().ffmpegPath;
	const probe = (filePath: string) => h.media.probe({ requestId: "probe", source: { path: filePath } });

	const captureFrame = async (name: string, time: number): Promise<void> => {
		// The plan inputs are the model's declared attrs, as the preview panel hands them to the host.
		const clipCount = snapshotFromGraphDump(dump()).tracks.reduce((total, track) => total + track.clips.length, 0);
		const structure = (await waitForAttr(
			page,
			root,
			"previewStructure",
			(value) => ((value as { clipSources?: unknown[] } | null)?.clipSources?.length ?? 0) === clipCount,
		)) as { clipSources?: unknown[] } | null;
		const read = (attr: string) => waitForAttr(page, project, attr, (value) => typeof value === "number");
		const input: PreviewPlanInput = {
			projectId: project._nodeId ?? "",
			fps: (await read("fps")) as number,
			width: (await read("width")) as number,
			height: (await read("height")) as number,
			duration: (await read("duration")) as number,
			clipSources: (structure?.clipSources ?? []) as never,
		};
		let setSource!: () => void;
		const sourceSet = new Promise<void>((resolve) => {
			setSource = resolve;
		});
		let failPlan!: (error: Error) => void;
		const planFailed = new Promise<never>((_, reject) => {
			failPlan = reject;
		});
		let dispose = () => {};
		const controller = createRoot((disposeRoot) => {
			dispose = disposeRoot;
			return createNodePreviewController({
				ffmpegPath,
				assets: h.registry,
				probe,
				// Observes when the plan reached the producer: a request made earlier would be answered with black.
				createProducer: (options) => {
					const producer = createPreviewProducer(options);
					return {
						...producer,
						onError(listener) {
							return producer.onError((error, generation) => {
								failPlan(new Error(`preview decode failed at ${time}s: ${error.message}`));
								listener(error, generation);
							});
						},
						setSource(source) {
							producer.setSource(source);
							setSource();
						},
					};
				},
			});
		});
		try {
			controller.updatePlan(input);
			// The plan duration follows the clips (the project attr stays 0), so any clip makes it visible.
			const visible = input.clipSources.length > 0;
			if (visible) await sourceSet;
			expect(controller.notice()).toBeNull();
			const frame = await Promise.race([planFailed, new Promise<PreviewFrame & { pixels: Uint8Array }>((resolve) => {
				let target = -1;
				const stop = controller.source.subscribe((delivered) => {
					if (target >= 0 && delivered.generation < target) {
						delivered.release();
						return;
					}
					stop();
					const copy = { ...delivered, pixels: Uint8Array.from(delivered.pixels), release() {} };
					delivered.release();
					resolve(copy);
				});
				target = controller.source.request(time);
			})]);
			const file = `frame-${name}.png`;
			writeFileSync(path.join(artifacts, file), encodeRgbaPng(frame.width, frame.height, frame.pixels));
			frames.push({ name, time, file, error: null, content: containedRect(frame.width, frame.height) });
		} catch (error) {
			// A preview the host cannot render is an outcome of the scenario, not a crash of the run.
			frames.push({
				name,
				time,
				file: null,
				error: error instanceof Error ? error.message : String(error),
				content: containedRect(PREVIEW_WIDTH * PREVIEW_PIXEL_RATIO, PREVIEW_HEIGHT * PREVIEW_PIXEL_RATIO),
			});
		} finally {
			await controller.dispose();
			dispose();
		}
	};

	let current: ParitySnapshot | null = null;
	for (const step of PARITY_STEPS) {
		switch (step.op) {
			case "import": {
				const paths = step.files.map(inputPath);
				await createImportFromDialog(async () => paths, importer)();
				await waitForAttr(page, project, "importProgress", (value) => (value as { stage?: string } | null)?.stage === "done");
				// The first video of an empty timeline is placed with its audio.
				current = await waitForSnapshot(
					(snapshot) =>
						snapshot.resources.length === step.files.length &&
						snapshot.tracks.length === 2 &&
						snapshot.tracks.every((track) => track.clips.length > 0),
					"import",
				);
				break;
			}
			case "addToTimeline": {
				const resourceId = resourceNodeIdFromDump(dump(), step.resource);
				if (!resourceId) throw new Error(`No resource ${step.resource}`);
				current = await afterAction(
					() => page.dispatchAndWait("addActiveProjectResourceToTimeline", resourceId, null),
					`add ${step.resource}`,
				);
				break;
			}
			case "clip": {
				const scope = clipScope(step.clip);
				current = await afterAction(
					() => page.dispatchAndWait(step.action, step.payload, scope),
					`${step.action} ${step.clip.name}`,
				);
				break;
			}
			case "select": {
				const clipId = clipNodeIdFromDump(dump(), step.clip);
				if (!clipId) throw new Error(`No clip ${JSON.stringify(step.clip)}`);
				current = await afterAction(() => page.dispatchAndWait("selectEntity", clipId, null), "select");
				break;
			}
			case "root": {
				current = await afterAction(
					() => page.dispatchAndWait(step.action, step.payload, null),
					step.action,
				);
				break;
			}
			case "checkpoint": {
				if (!current) throw new Error("checkpoint before any state");
				checkpoints[step.name] = current;
				break;
			}
			case "frame": {
				current = await afterAction(() => page.dispatchAndWait("setCursor", step.time, null), `cursor ${step.time}`);
				await captureFrame(step.name, step.time);
				break;
			}
			case "export": {
				const id = `export:parity:${step.name}:${crypto.randomUUID()}`;
				await page.dispatchAndWait("requestProjectExport", { id, initiatedBy: root._nodeId }, root);
				const progress = (await waitForAttr(page, root, "exportProgress", (value) => {
					const state = value as { id?: string; stage?: string } | null;
					return state?.id === id && (state.stage === "done" || state.stage === "error");
				})) as { stage: string; fileName?: string; error?: string };
				if (progress.stage === "done") {
					const file = `export-${step.name}.webm`;
					copyFileSync(path.join(h.exportDirectory, progress.fileName as string), path.join(artifacts, file));
					exports.push({ name: step.name, file, error: null });
				} else {
					exports.push({ name: step.name, file: null, error: progress.error ?? "export failed" });
				}
				break;
			}
		}
	}

	const manifest: ParityManifest = {
		platform: "desktop",
		checkpoints,
		frames,
		exports,
		elapsedMs: Math.round(performance.now() - startedAt),
	};
	writeManifest(manifest);
	expect(Object.keys(checkpoints).length).toBeGreaterThan(0);
}, SCENARIO_TIMEOUT_MS);
