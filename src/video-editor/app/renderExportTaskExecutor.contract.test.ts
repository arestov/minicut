import { describe, expect, it, vi } from "vitest";
import {
	createActionContractHarness,
	dispatchAndSettle,
} from "../dkt/models/action-contract-test-harness";
import type {
	ExportRenderRequest,
	ExportRenderResult,
} from "../render/exportRenderer";
import { createAuthorityExtensionBus } from "./authorityExtensionBus";
import type { EditorActionEnvironment } from "./editorActionEnvironment";
import type { ExportRequestState } from "./exportRequestState";
import { executeRenderExportTask } from "./renderExportTaskExecutor";
import { createRuntimeTaskFacade } from "./runtimeTaskFacade";

const findProjectExportRequest = (
	exportRequests: unknown[],
	id: string,
): ExportRequestState | null => {
	const match = exportRequests.find(
		(entry) =>
			(entry as { request?: { id?: unknown } } | null)?.request?.id === id,
	);
	const request = (match as { request?: unknown } | null)?.request;
	if (!request || typeof request !== "object") {
		return null;
	}
	return request as ExportRequestState;
};

const createTestEnv = ({
	renderer,
	taskPort,
	resolveResourceUrl,
	dktDispatches,
}: {
	renderer: { render: ReturnType<typeof vi.fn> };
	taskPort: ReturnType<typeof createRuntimeTaskFacade>;
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string;
	dktDispatches: Array<{ actionName: string; payload: unknown }>;
}): EditorActionEnvironment => ({
	pageRuntime: null,
	dkt: {
		dispatch(actionName: string, payload?: unknown) {
			dktDispatches.push({ actionName, payload: payload ?? null });
		},
	},
	media: {
		getFileKind: () => null,
		createObjectUrl: () => "blob:download-export",
		revokeObjectUrl: () => {},
		getImportedResourceDuration: async () => 0,
	},
	export: {
		renderer,
		cachedResults: new Map<
			string,
			{ downloadUrl: string; blob: Blob; timestamp: number }
		>(),
	},
	transfers: {
		manager: {} as EditorActionEnvironment["transfers"]["manager"],
		getPeerId: () => null,
		resolveResourceUrl,
		requestPlayheadWindow: () => {},
		notePreviewError: () => {},
	},
	lifecycle: {
		isDestroyed: () => false,
		setTimeout: (handler: () => void, timeoutMs: number) =>
			setTimeout(handler, timeoutMs),
		clearTimeout: (timerId: ReturnType<typeof setTimeout>) =>
			clearTimeout(timerId),
		registerObjectUrl: () => {},
	},
	tasks: taskPort,
	platform: {} as EditorActionEnvironment["platform"],
	resourceChunkSize: 64 * 1024,
});

describe("render export task executor contract", () => {
	it("sends renderer request with node-based resourceId and resolved resourceUrl for project export", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(harness.ctx, harness.project, "importResource", {
			name: "Export Source",
			kind: "video",
			url: "https://example.invalid/export-source.webm",
			mime: "video/webm",
			duration: 4,
			size: 400,
			source: { kind: "local" },
			status: "ready",
			data: { status: "ready" },
		});

		const resources = await harness.ctx.queryRel(harness.project, "resources");
		const exportResource = resources.find(
			(resource) => harness.ctx.getAttr(resource, "name") === "Export Source",
		);
		if (!exportResource?._node_id) {
			throw new Error("Expected imported export resource");
		}
		const exportResourceId = String(exportResource._node_id);

		await dispatchAndSettle(
			harness.ctx,
			harness.project,
			"addResourceToTimeline",
			exportResourceId,
		);

		const clips = await harness.ctx.queryRel(harness.videoTrack, "clips");
		const exportClip = clips.find((clip) => {
			const renderData = harness.ctx.getAttr(clip, "clipRenderData") as {
				resourceId?: unknown;
			} | null;
			return renderData?.resourceId === exportResourceId;
		});
		if (!exportClip?._node_id) {
			throw new Error("Expected timeline clip for export resource");
		}
		const exportClipId = String(exportClip._node_id);

		const requestId = "export:project-contract";
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"requestProjectExport",
			{
				id: requestId,
				initiatedBy: "unit-test",
			},
		);

		const request = findProjectExportRequest(harness.exportRequests, requestId);
		if (!request) {
			throw new Error("Expected project export request payload");
		}

		const planClipBeforeResolve = request.plan.clipSources.find(
			(clipSource) =>
				clipSource.id === exportClipId &&
				clipSource.resourceId === exportResourceId,
		);
		expect(planClipBeforeResolve).toBeTruthy();
		expect(planClipBeforeResolve?.resourceUrl).toBe(
			"https://example.invalid/export-source.webm",
		);

		const resolvedUrl = "blob:resolved-export-source";
		const renderer = {
			render: vi.fn(
				async (
					renderRequest: ExportRenderRequest,
				): Promise<ExportRenderResult> => ({
					id: requestId,
					fileName: "export.webm",
					mimeType: "video/webm",
					blob: new Blob(["export-bytes"], { type: "video/webm" }),
					size: 12,
					duration: 4,
					frameCount: 120,
					manifest: {
						format: "video-webm",
						projectId: renderRequest.plan.projectId,
						range: renderRequest.range,
						start: 0,
						duration: renderRequest.plan.duration,
						fps: renderRequest.plan.fps,
						frameCount: 120,
						clips: [],
						frames: [],
					},
				}),
			),
		};

		const taskPort = createRuntimeTaskFacade();
		const task = taskPort.dispatchTask(
			"$fx_renderExport",
			{ data: request },
			{
				queuePolicy: "replace-last",
				intentKey: "$fx_renderExport:project",
			},
		);

		const dktDispatches: Array<{ actionName: string; payload: unknown }> = [];
		const env = createTestEnv({
			renderer,
			taskPort,
			resolveResourceUrl: (resourceId: string, fallbackUrl: string) =>
				resourceId === exportResourceId ? resolvedUrl : fallbackUrl,
			dktDispatches,
		});

		await executeRenderExportTask({
			task,
			env,
			extensionBus: createAuthorityExtensionBus(),
		});

		expect(renderer.render).toHaveBeenCalledTimes(1);
		const rendererRequest = renderer.render.mock
			.calls[0]?.[0] as ExportRenderRequest;
		const planClipSentToRenderer = rendererRequest.plan.clipSources.find(
			(clipSource) =>
				clipSource.id === exportClipId &&
				clipSource.resourceId === exportResourceId,
		);
		expect(planClipSentToRenderer).toBeTruthy();
		expect(planClipSentToRenderer?.resourceId).toBe(exportResourceId);
		expect(planClipSentToRenderer?.resourceUrl).toBe(resolvedUrl);
		expect(planClipSentToRenderer?.resourceUrl).not.toBe("");

		expect(
			dktDispatches.some((entry) => entry.actionName === "setExportProgress"),
		).toBe(true);
		expect(
			dktDispatches.some(
				(entry) =>
					entry.actionName === "consumeExportRequest" &&
					(entry.payload as { id?: unknown } | null)?.id === requestId,
			),
		).toBe(true);
	});

	it("fails fast before renderer when media clip has empty resolved resourceUrl", async () => {
		const harness = await createActionContractHarness();
		const requestId = "export:project-contract-missing-url";

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"requestProjectExport",
			{
				id: requestId,
				initiatedBy: "unit-test",
			},
		);

		const request = findProjectExportRequest(harness.exportRequests, requestId);
		if (!request) {
			throw new Error("Expected project export request payload");
		}

		const mediaClip = request.plan.clipSources.find(
			(clipSource) =>
				clipSource.resourceKind === "video" ||
				clipSource.resourceKind === "audio" ||
				clipSource.resourceKind === "image",
		);
		if (!mediaClip?.resourceId) {
			throw new Error("Expected at least one media clip with resource id");
		}

		const brokenRequest: ExportRequestState = {
			...request,
			plan: {
				...request.plan,
				clipSources: request.plan.clipSources.map((clipSource) =>
					clipSource.id === mediaClip.id
						? { ...clipSource, resourceUrl: "" }
						: clipSource,
				),
			},
		};

		const renderer = {
			render: vi.fn(
				async (): Promise<ExportRenderResult> => ({
					id: requestId,
					fileName: "export.webm",
					mimeType: "video/webm",
					blob: new Blob(["export-bytes"], { type: "video/webm" }),
					size: 12,
					duration: 4,
					frameCount: 120,
					manifest: {
						format: "video-webm",
						projectId: request.plan.projectId,
						range: { type: "project" },
						start: 0,
						duration: request.plan.duration,
						fps: request.plan.fps,
						frameCount: 120,
						clips: [],
						frames: [],
					},
				}),
			),
		};
		const taskPort = createRuntimeTaskFacade();
		const task = taskPort.dispatchTask(
			"$fx_renderExport",
			{ data: brokenRequest },
			{
				queuePolicy: "replace-last",
				intentKey: "$fx_renderExport:project",
			},
		);

		const dktDispatches: Array<{ actionName: string; payload: unknown }> = [];
		const env = createTestEnv({
			renderer,
			taskPort,
			resolveResourceUrl: () => "",
			dktDispatches,
		});

		await executeRenderExportTask({
			task,
			env,
			extensionBus: createAuthorityExtensionBus(),
		});

		expect(renderer.render).not.toHaveBeenCalled();

		const errorProgressDispatch = dktDispatches.find(
			(entry) =>
				entry.actionName === "setExportProgress" &&
				(entry.payload as { stage?: unknown } | null)?.stage === "error",
		);
		expect(errorProgressDispatch).toBeTruthy();
		expect(
			String(
				(errorProgressDispatch?.payload as { error?: unknown } | null)?.error ??
					"",
			),
		).toContain("missing resourceUrl");
		expect(
			dktDispatches.some(
				(entry) =>
					entry.actionName === "consumeExportRequest" &&
					(entry.payload as { id?: unknown } | null)?.id === requestId,
			),
		).toBe(true);

		const taskDump = taskPort.debugDumpTasksTesting();
		expect(taskDump.failed).toBeGreaterThanOrEqual(1);
	});
});
