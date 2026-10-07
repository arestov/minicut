import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { FileArtifact } from "../../../video-editor/media/contracts/job";
import type { MediaExportRequest } from "../../../video-editor/media/contracts/export";
import { MediaJobController } from "../../../video-editor/media/node/mediaJob";
import { createExportExecutor } from "../../../video-editor/hosts/desktop/exportExecutor";
import type { HostPage } from "../../../video-editor/hosts/desktop/hostTypes";

const MEDIA_DIR = path.resolve("media-dir");
const EXPORT_DIR = path.resolve("export-dir");

type Dispatched = { action: string; payload: Record<string, unknown> };

/** Page double: records dispatches and lets a test wait for the next matching one. */
const fakePage = () => {
	const dispatched: Dispatched[] = [];
	const waiters: Array<{ match: (d: Dispatched) => boolean; resolve: () => void }> = [];
	const page: HostPage = {
		dispatch(action, payload) {
			const entry = { action, payload: payload as Record<string, unknown> };
			dispatched.push(entry);
			for (const waiter of [...waiters]) {
				if (waiter.match(entry)) {
					waiters.splice(waiters.indexOf(waiter), 1);
					waiter.resolve();
				}
			}
		},
		dispatchAndWait: () => Promise.resolve(),
		getRootScope: () => null,
	};
	const until = (match: (d: Dispatched) => boolean) =>
		new Promise<void>((resolve) => {
			if (dispatched.some(match)) resolve();
			else waiters.push({ match, resolve });
		});
	return { page, dispatched, until };
};

/** Resource ids that have no local asset (sourceKind other than local-asset). */
const NO_ASSET = new Set(["no-asset"]);

const clipSource = (resourceId: string) => ({
	id: `clip-${resourceId}`,
	name: `Clip ${resourceId}`,
	resourceId,
	resourceKind: "video",
	resourceUrl: "",
	resourceSource: NO_ASSET.has(resourceId)
		? { sourceKind: "missing", sourceRef: null }
		: { sourceKind: "local-asset", sourceRef: "asset-1" },
	start: 0,
	duration: 2,
	inPoint: 0,
});

const requestPayload = (id: string, resourceIds: string[], queueKey = "project") => ({
	queueKey,
	request: {
		id,
		range: { type: "project" },
		format: "video-webm",
		requestedAt: 1,
		initiatedBy: "root",
		plan: {
			projectId: "p",
			fps: 25,
			width: 320,
			height: 240,
			duration: 2,
			clipSources: resourceIds.map(clipSource),
		},
	},
});

const setup = () => {
	const { page, dispatched, until } = fakePage();
	const jobs: Array<{ request: MediaExportRequest; job: MediaJobController<FileArtifact> }> = [];
	const jobWaiters: Array<{ count: number; resolve: () => void }> = [];
	const untilJobs = (count: number) =>
		new Promise<void>((resolve) => {
			if (jobs.length >= count) resolve();
			else jobWaiters.push({ count, resolve });
		});
	const executor = createExportExecutor({
		page,
		media: {
			exportPlan(request) {
				const job = new MediaJobController<FileArtifact>(request.requestId);
				job.setCancelHandler(() => job.cancelled());
				jobs.push({ request, job });
				for (const waiter of [...jobWaiters]) {
					if (jobs.length >= waiter.count) {
						jobWaiters.splice(jobWaiters.indexOf(waiter), 1);
						waiter.resolve();
					}
				}
				return job;
			},
		},
		assets: {
			resolve: (assetId) => ({
				ok: true,
				location: { path: path.join(MEDIA_DIR, `${assetId}.mp4`) },
			}),
		},
		exportDirectory: EXPORT_DIR,
	});
	const actions = (name: string) => dispatched.filter((d) => d.action === name);
	return { executor, jobs, dispatched, until, untilJobs, actions };
};

describe("export executor", () => {
	test("maps media job events to one setExportProgress dispatch each, then consumes the request", async () => {
		const { executor, jobs, dispatched, until, untilJobs } = setup();

		executor.handleRequest(requestPayload("export:1", ["r1"]));
		await until((d) => d.action === "setExportProgress" && d.payload.stage === "queued");
		await untilJobs(1);
		const { request, job } = jobs[0];
		expect(request).toMatchObject({
			requestId: "export:1",
			format: "webm",
			assets: { r1: { path: path.join(MEDIA_DIR, "asset-1.mp4") } },
		});
		expect(request.outputPath).toBe(path.join(EXPORT_DIR, "minicut-export_1.webm"));

		job.emitProgress({ stage: "rendering", ratio: 0.5 });
		job.done({ path: path.join(EXPORT_DIR, "minicut-export_1.webm"), size: 10, durationSeconds: 2, frameCount: 50 });
		await until((d) => d.action === "consumeExportRequest");

		expect(
			dispatched.map((d) => [d.action, d.payload.stage, d.payload.progress]),
		).toEqual([
			["setExportProgress", "queued", 0],
			["setExportProgress", "rendering", 50],
			["setExportProgress", "done", 100],
			["consumeExportRequest", undefined, undefined],
		]);
		expect(dispatched[2].payload).toMatchObject({
			id: "export:1",
			fileName: "minicut-export_1.webm",
			size: 10,
			frameCount: 50,
		});
		expect(dispatched[3].payload).toEqual({ id: "export:1" });
	});

	test("a media error becomes an export error with its message", async () => {
		const { executor, jobs, dispatched, until, untilJobs } = setup();

		executor.handleRequest(requestPayload("export:2", ["r1"]));
		await untilJobs(1);
		jobs[0].job.fail({
			code: "unsupported-operation",
			message: "FFmpeg export does not support: effect",
		});
		await until((d) => d.action === "consumeExportRequest");

		expect(dispatched.find((d) => d.payload.stage === "error")?.payload).toMatchObject({
			id: "export:2",
			error: "FFmpeg export does not support: effect",
		});
	});

	test("a resource without a local asset is an error before any job starts", async () => {
		const { executor, jobs, dispatched, until, untilJobs } = setup();

		executor.handleRequest(requestPayload("export:3", ["no-asset"]));
		await until((d) => d.action === "consumeExportRequest");

		expect(jobs).toHaveLength(0);
		expect(dispatched.find((d) => d.payload.stage === "error")?.payload.error).toContain(
			"not available on this device",
		);
	});

	test("a new request with the same queue key cancels the running one without reporting it", async () => {
		const { executor, jobs, dispatched, until, untilJobs } = setup();

		executor.handleRequest(requestPayload("export:old", ["r1"]));
		await untilJobs(1);
		executor.handleRequest(requestPayload("export:new", ["r1"]));
		await untilJobs(2);

		expect(jobs[0].job.cancelRequested).toBe(true);
		jobs[1].job.done({ path: path.join(EXPORT_DIR, "x.webm"), size: 1, durationSeconds: 2, frameCount: 1 });
		await until((d) => d.action === "consumeExportRequest");

		const consumed = dispatched.filter((d) => d.action === "consumeExportRequest");
		expect(consumed.map((d) => d.payload.id)).toEqual(["export:new"]);
		expect(
			dispatched.some((d) => d.payload.id === "export:old" && d.payload.stage === "error"),
		).toBe(false);
	});

	test("cancel stops the job of the named export without reporting or consuming", async () => {
		const { executor, jobs, dispatched, untilJobs } = setup();

		executor.handleRequest(requestPayload("export:5", ["r1"]));
		await untilJobs(1);
		const before = dispatched.length;

		executor.cancel({ id: "export:other", queueKey: "project" });
		expect(jobs[0].job.cancelRequested).toBe(false);
		executor.cancel({ id: "export:5", queueKey: "project" });
		expect(jobs[0].job.cancelRequested).toBe(true);

		await executor.dispose();
		expect(dispatched).toHaveLength(before);
	});

	test("dispose cancels running jobs and reports nothing further", async () => {
		const { executor, jobs, dispatched, until, untilJobs } = setup();

		executor.handleRequest(requestPayload("export:4", ["r1"]));
		await untilJobs(1);
		const before = dispatched.length;

		await executor.dispose();

		expect(jobs[0].job.cancelRequested).toBe(true);
		expect(dispatched).toHaveLength(before);
	});
});
