import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createNodeAssetRegistry,
	type NodeAssetRegistry,
} from "../../../adapters/node/nodeAssetRegistry";
import type { FileArtifact } from "../../../media/contracts/job";
import type { ProbeResult } from "../../../media/contracts/probe";
import { MediaJobController } from "../../../media/node/mediaJob";
import type { DesktopMediaService } from "../../../media/node/rpc/mediaServiceClient";
import {
	createDesktopExecutors,
	type ExecutorSession,
	type PreviewProxyStatus,
} from "./desktopExecutors";
import type { HostAction } from "./windowConnector";

/** One action a window's session was asked to run, and by which session. */
type Dispatch = {
	via: string;
	actionName: string;
	payload: Record<string, unknown>;
	scopeNodeId: string | null;
};

const createFakeSessions = (rootNodeIds: readonly string[]) => {
	const dispatches: Dispatch[] = [];
	const waiters: Array<{ accept(dispatch: Dispatch): boolean; resolve(dispatch: Dispatch): void }> = [];
	const record = (via: string, action: HostAction) => {
		const entry: Dispatch = {
			via,
			actionName: action.actionName,
			payload: (action.payload ?? {}) as Record<string, unknown>,
			scopeNodeId: action.scopeNodeId ?? null,
		};
		dispatches.push(entry);
		for (const waiter of [...waiters]) {
			if (waiter.accept(entry)) {
				waiters.splice(waiters.indexOf(waiter), 1);
				waiter.resolve(entry);
			}
		}
	};
	const live = new Set(rootNodeIds);
	const sessionList = (): ExecutorSession[] =>
		rootNodeIds
			.filter((rootNodeId) => live.has(rootNodeId))
			.map((rootNodeId) => ({
				rootNodeId,
				dispatch: (action) => record(rootNodeId, action),
				dispatchAndWait: async (action) => record(rootNodeId, action),
			}));
	return {
		sessions: sessionList,
		close: (rootNodeId: string) => live.delete(rootNodeId),
		dispatches,
		next: (accept: (dispatch: Dispatch) => boolean) =>
			new Promise<Dispatch>((resolve) => {
				const existing = dispatches.find(accept);
				if (existing) resolve(existing);
				else waiters.push({ accept, resolve });
			}),
	};
};

const probeResult = {
	formatName: "mov,mp4",
	durationSeconds: 2,
	video: { width: 320, height: 240, fps: 25, nominalFps: 25, frameCount: 50 },
	audio: null,
} as unknown as ProbeResult;

describe("desktop executors", () => {
	let tempDir: string;
	let registry: NodeAssetRegistry;
	let dropped: Array<{ fx: string; reason: string }>;
	let dropWaiters: Array<{ count: number; resolve(): void }>;
	/** Resolves once `count` requests have been dropped. */
	const droppedCount = (count: number): Promise<void> =>
		new Promise((resolve) => {
			if (dropped.length >= count) resolve();
			else dropWaiters.push({ count, resolve });
		});
	let failed: Array<{ fx: string; error: unknown }>;
	let failWaiters: Array<() => void>;
	const firstFailure = (): Promise<void> =>
		new Promise((resolve) => {
			if (failed.length > 0) resolve();
			else failWaiters.push(resolve);
		});
	let jobs: MediaJobController<FileArtifact>[];
	let jobWaiters: Array<{ count: number; resolve(): void }>;
	/** Resolves once the media service has been asked for `count` export jobs. */
	const jobsStarted = (count: number): Promise<void> =>
		new Promise((resolve) => {
			if (jobs.length >= count) resolve();
			else jobWaiters.push({ count, resolve });
		});
	let clipPath: string;
	let idSequence: number;
	/** Proxy generations the executors asked for, each settled by the test. */
	let proxyRequests: Array<{
		contentKey: string;
		sourcePath: string;
		settle(result: { path: string } | { error: Error }): void;
	}>;
	let proxyChanges: Array<{ assetId: string; status: PreviewProxyStatus }>;
	let proxyWaiters: Array<{ count: number; resolve(): void }>;
	/** Resolves once `count` proxy state changes were reported. */
	const proxyChangeCount = (count: number): Promise<void> =>
		new Promise((resolve) => {
			if (proxyChanges.length >= count) resolve();
			else proxyWaiters.push({ count, resolve });
		});
	let probed: ProbeResult;

	const media: DesktopMediaService = {
		probe: async () => probed,
		fingerprint: async () => ({ fingerprint: "fp", version: "v1" }),
		capabilities: async () => {
			throw new Error("not used");
		},
		exportPlan: (request) => {
			const job = new MediaJobController<FileArtifact>(request.requestId);
			job.setCancelHandler(() => job.cancelled());
			jobs.push(job);
			for (const waiter of jobWaiters.filter((candidate) => jobs.length >= candidate.count)) {
				waiter.resolve();
			}
			return job;
		},
		generateProxy: () => {
			throw new Error("not used");
		},
	};

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-desktop-executors-"));
		registry = await createNodeAssetRegistry({ filePath: path.join(tempDir, "assets.json") });
		clipPath = path.join(tempDir, "clip.mp4");
		await writeFile(clipPath, Buffer.alloc(64));
		dropped = [];
		dropWaiters = [];
		failed = [];
		failWaiters = [];
		jobs = [];
		jobWaiters = [];
		idSequence = 0;
		proxyRequests = [];
		proxyChanges = [];
		proxyWaiters = [];
		probed = probeResult;
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const start = () => {
		const fake = createFakeSessions(["root-a", "root-b"]);
		const executors = createDesktopExecutors({
			getSessions: fake.sessions,
			media,
			registry,
			proxies: {
				ensure: (source) =>
					new Promise<string>((resolve, reject) => {
						proxyRequests.push({
							...source,
							settle: (result) =>
								"error" in result ? reject(result.error) : resolve(result.path),
						});
					}),
			},
			onProxyChanged: (assetId, status) => {
				proxyChanges.push({ assetId, status });
				for (const waiter of proxyWaiters.filter((candidate) => proxyChanges.length >= candidate.count)) {
					waiter.resolve();
				}
			},
			exportDirectory: path.join(tempDir, "exports"),
			ownerPeerId: "peer",
			assetUrl: (assetId) => `/asset/${assetId}`,
			generateId: () => `id-${(idSequence += 1)}`,
			now: () => 1,
			onDropped: (fx, reason) => {
				dropped.push({ fx, reason });
				for (const waiter of dropWaiters.filter((candidate) => dropped.length >= candidate.count)) {
					waiter.resolve();
				}
			},
			onFailed: (fx, error) => {
				failed.push({ fx, error });
				for (const resolve of failWaiters.splice(0)) resolve();
			},
		});
		return { fake, executors };
	};

	const exportRequest = (id: string, initiatedBy: string) => ({
		request: {
			id,
			initiatedBy,
			range: { type: "project" },
			plan: { projectId: "p", fps: 25, width: 320, height: 240, duration: 1, clipSources: [] },
		},
		queueKey: "project",
	});

	it("imports a batch as local assets and reports to the window that staged it", async () => {
		const { fake, executors } = start();
		const batchA = executors.stageImport("root-a", [clipPath]);
		const batchB = executors.stageImport("root-b", [clipPath]);
		expect(batchA).not.toBe(batchB);

		executors.requestImportFiles({ projectId: "project-b", inputBatchHandleId: batchB });
		const done = await fake.next(
			(d) => d.actionName === "setActiveProjectImportProgress" && d.payload.stage === "done",
		);

		// The progress lands in the staging window's session, as that session.
		expect(done.via).toBe("root-b");
		expect(done.scopeNodeId).toBe("root-b");
		const imported = fake.dispatches.find((d) => d.actionName === "importResource");
		expect(imported).toMatchObject({ via: "root-b", scopeNodeId: "project-b" });
		const assetId = String(imported?.payload.sourceRef);
		expect(imported?.payload).toMatchObject({
			sourceKind: "local-asset",
			url: `/asset/${assetId}`,
			kind: "video",
		});
		expect(registry.get(assetId)?.path).toBe(clipPath);
		expect(fake.dispatches.filter((d) => d.via === "root-a")).toEqual([]);
	});

	const importClip = async (fake: ReturnType<typeof createFakeSessions>, executors: ReturnType<typeof start>["executors"]) => {
		const batch = executors.stageImport("root-a", [clipPath]);
		executors.requestImportFiles({ projectId: "project-a", inputBatchHandleId: batch });
		await fake.next((d) => d.actionName === "setActiveProjectImportProgress" && d.payload.stage === "done");
		return String(fake.dispatches.find((d) => d.actionName === "importResource")?.payload.sourceRef);
	};

	it("generates the scrub proxy of an imported video, keyed by its content, without holding the import", async () => {
		const { fake, executors } = start();

		const assetId = await importClip(fake, executors);
		await proxyChangeCount(1);

		// The import finished while the proxy is still being made.
		expect(executors.previewProxy(assetId)).toEqual({ state: "generating" });
		expect(executors.previewProxyPath(assetId)).toBeNull();
		expect(proxyRequests).toHaveLength(1);
		expect(proxyRequests[0]).toMatchObject({ contentKey: "v1/fp", sourcePath: clipPath });

		const proxyPath = path.join(tempDir, "proxy.mp4");
		proxyRequests[0].settle({ path: proxyPath });
		await proxyChangeCount(2);

		expect(executors.previewProxy(assetId)).toEqual({ state: "ready", path: proxyPath });
		expect(executors.previewProxyPath(assetId)).toBe(proxyPath);
	});

	it("records a failed proxy as a state of the asset, not as an import error", async () => {
		const { fake, executors } = start();

		const assetId = await importClip(fake, executors);
		await proxyChangeCount(1);
		proxyRequests[0].settle({ error: new Error("ffmpeg could not encode") });
		await proxyChangeCount(2);

		expect(executors.previewProxy(assetId)).toEqual({
			state: "failed",
			message: "ffmpeg could not encode",
		});
		expect(executors.previewProxyPath(assetId)).toBeNull();
		expect(fake.dispatches.find((d) => d.payload.stage === "error")).toBeUndefined();
		expect(failed).toEqual([]);
	});

	it("makes no proxy for audio or images", async () => {
		const { fake, executors } = start();
		probed = {
			formatName: "wav",
			durationSeconds: 2,
			video: null,
			audio: { channels: 2, sampleRate: 48000 },
		} as unknown as ProbeResult;

		const assetId = await importClip(fake, executors);

		expect(proxyRequests).toEqual([]);
		expect(executors.previewProxy(assetId)).toBeNull();
	});

	it("drops an import whose batch no window staged or whose window is gone", async () => {
		const { fake, executors } = start();
		const batch = executors.stageImport("root-a", [clipPath]);
		fake.close("root-a");

		executors.requestImportFiles({ projectId: "p", inputBatchHandleId: "never-staged" });
		executors.requestImportFiles({ projectId: "p", inputBatchHandleId: batch });
		await droppedCount(2);

		expect(dropped).toEqual([
			{ fx: "$fx_handleInputFiles", reason: "no window staged this import batch" },
			{ fx: "$fx_handleInputFiles", reason: "the window that staged this import is gone" },
		]);
		expect(fake.dispatches).toEqual([]);
	});

	it("runs an export for the window that started it, with queue keys of its own", async () => {
		const { fake, executors } = start();

		executors.requestExport(exportRequest("export-a", "root-a"));
		executors.requestExport(exportRequest("export-b", "root-b"));
		await jobsStarted(2);
		expect(jobs.map((job) => job.requestId)).toEqual(["export-a", "export-b"]);
		jobs[1].done({ path: path.join(tempDir, "b.webm"), size: 3, durationSeconds: 1, frameCount: 25 });
		const doneB = await fake.next((d) => d.payload.id === "export-b" && d.payload.stage === "done");

		// Window A's export of the same queue key was not superseded by B's.
		expect(jobs[0].cancelRequested).toBe(false);
		expect(doneB.via).toBe("root-b");
		expect(doneB.scopeNodeId).toBe("root-b");
		expect(fake.dispatches.filter((d) => d.payload.id === "export-a").map((d) => d.via)).toEqual([
			"root-a",
		]);
		await executors.dispose();
	});

	it("cancels an export only for the window that started it", async () => {
		const { executors } = start();
		executors.requestExport(exportRequest("export-a", "root-a"));
		await jobsStarted(1);
		const cancelled = new Promise<void>((resolve) => jobs[0].onCancelled(resolve));

		// B cancelling A's request does nothing; A's own cancel ends the job.
		executors.cancelExport({ id: "export-a", queueKey: "project", initiatedBy: "root-b" });
		executors.cancelExport({ id: "export-a", queueKey: "project", initiatedBy: "root-a" });
		await cancelled;

		expect(jobs[0].cancelRequested).toBe(true);
		await executors.dispose();
	});

	it("drops an export of a session that is not connected", async () => {
		const { executors } = start();

		executors.requestExport(exportRequest("export-x", "root-gone"));
		executors.requestExport({ request: { id: "export-y" } });
		await droppedCount(2);

		expect(dropped).toEqual([
			{ fx: "$fx_renderExport", reason: "the window that started this export is gone" },
			{ fx: "$fx_renderExport", reason: "the export request names no session" },
		]);
		expect(jobs).toEqual([]);
	});

	it("stops the exports of a window that closed and releases its executors", async () => {
		const { fake, executors } = start();
		executors.requestExport(exportRequest("export-a", "root-a"));
		await jobsStarted(1);

		await executors.retainRoots(new Set(["root-b"]));

		expect(jobs[0].cancelRequested).toBe(true);
		// A cancelled-by-shutdown export reports nothing to the model.
		expect(fake.dispatches.filter((d) => d.payload.stage === "error")).toEqual([]);
	});

	it("never writes to a window that closed while its export was running", async () => {
		const { fake, executors } = start();
		executors.requestExport(exportRequest("export-a", "root-a"));
		await jobsStarted(1);
		const before = fake.dispatches.length;
		fake.close("root-a");

		jobs[0].done({ path: path.join(tempDir, "a.webm"), size: 3, durationSeconds: 1, frameCount: 25 });
		await jobs[0].outcome;
		await executors.dispose();

		expect(fake.dispatches.length).toBe(before);
	});

	it("restores media for a resource through the shared recovery executor", async () => {
		const { fake, executors } = start();
		const missing = await registry.register(path.join(tempDir, "gone.mp4"));

		executors.requestMediaRecovery({
			taskId: "task-1",
			resourceId: "resource-1",
			operationId: "restore:1:resource-1",
			bootId: "1",
			intent: "restore",
			original: { kind: "video", duration: 2 },
			requiredSourceEnd: 2,
			sourceKind: "local-asset",
			sourceRef: missing.assetId,
		});
		const marked = await fake.next((d) => d.actionName === "recordAutomaticMediaRecovery");

		expect(marked.scopeNodeId).toBe("resource-1");
		expect(marked.payload).toMatchObject({ availability: "unavailable", originalAccess: "missing" });
		expect(failed).toEqual([]);
	});

	it("reports an executor failure instead of throwing into the runtime", async () => {
		const { executors } = start();
		executors.requestMediaRecovery({
			get taskId(): never {
				throw new Error("broken payload");
			},
		});
		await firstFailure();

		expect(failed).toHaveLength(1);
		expect(failed[0].fx).toBe("$fx_mediaRecovery");
	});
});
