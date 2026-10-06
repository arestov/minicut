import { describe, expect, it, vi } from "vitest";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import { executeImportFilesTask } from "./importFilesTaskExecutor";
import { createRuntimeTaskFacade } from "./runtimeTaskFacade";
import type { EditorActionEnvironment } from "./editorActionEnvironment";

const makeScope = (id: string): ReactSyncScopeHandle => ({ kind: "scope", _nodeId: id });

describe("executeImportFilesTask handle-backed imports", () => {
	it("creates the resource and recovery task declaratively without read-after-dispatch", async () => {
		const tasks = createRuntimeTaskFacade();
		const projectScope = makeScope("project:1");
		const resourceScope = makeScope("resource:1");
		const resourceAttrs: Record<string, unknown> = {};
		const resources: ReactSyncScopeHandle[] = [];
		const inputBatchHandleId = tasks.putRuntimeRef([
			{
				file: new File(["video"], "handle-video.webm", {
					type: "video/webm",
					lastModified: 1_780_000_002,
				}),
				handle: { kind: "file", name: "handle-video.webm" },
			},
		]);
		const task = tasks.dispatchTask("$fx_handleInputFiles", {
			data: { inputBatchHandleId },
		});
		const putHandle = vi.fn(async () => undefined);
		const putAsset = vi.fn(async () => ({ ok: true as const, assetRef: "project:1/resource:1" }));
		const dispatch = vi.fn((actionName: string, payload: unknown, scope) => {
			if (actionName === "importResource") {
				Object.assign(resourceAttrs, payload, { url: (payload as { url: string }).url });
				resources.push(resourceScope);
				return;
			}
			if (actionName === "setResourceAttrs" && scope === resourceScope) {
				Object.assign(resourceAttrs, payload);
			}
		});
		const env = {
			pageRuntime: {
				getRootScope: () => makeScope("root"),
				readOne: () => projectScope,
				readMany: (scope: ReactSyncScopeHandle, rel: string) =>
					scope === projectScope && rel === "resources" ? resources : [],
				readAttrs: (scope: ReactSyncScopeHandle) =>
					scope === resourceScope ? resourceAttrs : {},
			},
			dkt: {
				dispatch,
				dispatchAndWait: async (...args: Parameters<typeof dispatch>) => {
					dispatch(...args);
				},
			},
			media: {
				getFileKind: () => "video",
				createObjectUrl: () => "blob:http://localhost/handle-video",
				revokeObjectUrl: () => undefined,
				getImportedResourceDuration: async () => 1,
				fingerprintFile: async () => ({ fingerprint: "abc", version: "sha256-v1" }),
				estimateStorage: async () => ({ quota: 10_000, usage: 0 }),
			},
			export: { renderer: null, cachedResults: new Map() },
			transfers: {
				manager: null,
				getPeerId: () => null,
				resolveResourceUrl: (_resourceId: string, fallbackUrl: string) =>
					fallbackUrl,
				requestPlayheadWindow: () => undefined,
				notePreviewError: () => undefined,
			},
			lifecycle: {
				isDestroyed: () => false,
				setTimeout,
				clearTimeout,
				registerObjectUrl: () => undefined,
			},
			tasks,
			mediaHandles: {
				put: putHandle,
				get: vi.fn(),
				delete: vi.fn(),
				diagnostics: vi.fn(),
			},
			projectAssets: { putFromFile: putAsset },
			platform: null,
			resourceChunkSize: 1024,
		} as unknown as EditorActionEnvironment;

		await executeImportFilesTask({ task, env, projectScope });

		expect(putHandle).not.toHaveBeenCalled();
		expect(resourceAttrs).toMatchObject({
			addToTimelineWhenEmpty: true,
			sourceKind: "file-handle",
			sourceRef: null,
			status: "ready",
			assetStorageKind: "linked",
			assetRef: null,
			contentFingerprint: "abc",
			localMediaStatus: "ready-file-handle",
			recoveryKind: "import",
			intent: "restore",
			operationId: expect.any(String),
			runtimeHandleId: expect.any(String),
		});
		expect(putAsset).not.toHaveBeenCalled();
		expect(dispatch.mock.calls.some(([name]) => name === "setResourceAttrs")).toBe(false);
		expect(resources).toHaveLength(1);
	});

	it("marks injected File imports as runtime object URLs without storing handles", async () => {
		const tasks = createRuntimeTaskFacade();
		const projectScope = makeScope("project:object-url");
		const resourceScope = makeScope("resource:object-url");
		const resourceAttrs: Record<string, unknown> = {};
		const resources: ReactSyncScopeHandle[] = [];
		const inputBatchHandleId = tasks.putRuntimeRef([
			new File(["video"], "injected-video.webm", {
				type: "video/webm",
				lastModified: 1_780_000_003,
			}),
		]);
		const task = tasks.dispatchTask("$fx_handleInputFiles", {
			data: { inputBatchHandleId },
		});
		const putHandle = vi.fn(async () => undefined);
		const env = {
			pageRuntime: {
				getRootScope: () => makeScope("root"),
				readOne: () => projectScope,
				readMany: (scope: ReactSyncScopeHandle, rel: string) =>
					scope === projectScope && rel === "resources" ? resources : [],
				readAttrs: (scope: ReactSyncScopeHandle) =>
					scope === resourceScope ? resourceAttrs : {},
			},
			dkt: (() => {
				const dispatch = vi.fn((actionName: string, payload: unknown) => {
					if (actionName === "importResource") {
						Object.assign(resourceAttrs, payload);
						resources.push(resourceScope);
					}
				});
				return {
					dispatch,
					dispatchAndWait: async (...args: Parameters<typeof dispatch>) => {
						dispatch(...args);
					},
				};
			})(),
			media: {
				getFileKind: () => "video",
				createObjectUrl: () => "blob:http://localhost/injected-video",
				revokeObjectUrl: () => undefined,
				getImportedResourceDuration: async () => 1,
			},
			export: { renderer: null, cachedResults: new Map() },
			transfers: {
				manager: null,
				getPeerId: () => null,
				resolveResourceUrl: (_resourceId: string, fallbackUrl: string) =>
					fallbackUrl,
				requestPlayheadWindow: () => undefined,
				notePreviewError: () => undefined,
			},
			lifecycle: {
				isDestroyed: () => false,
				setTimeout,
				clearTimeout,
				registerObjectUrl: () => undefined,
			},
			tasks,
			mediaHandles: {
				put: putHandle,
				get: vi.fn(),
				delete: vi.fn(),
				diagnostics: vi.fn(),
			},
			platform: null,
			resourceChunkSize: 1024,
		} as unknown as EditorActionEnvironment;

		await executeImportFilesTask({ task, env, projectScope });

		expect(putHandle).not.toHaveBeenCalled();
		expect(resourceAttrs).toMatchObject({
			addToTimelineWhenEmpty: true,
			sourceKind: "object-url",
			sourceRef: null,
			status: "ready",
		});
	});
});
