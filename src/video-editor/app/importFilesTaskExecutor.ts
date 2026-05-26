import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";
import type { EditorActionEnvironment } from "./editorActionEnvironment";
import type { RuntimeTaskDescriptor } from "./runtimeTaskFacade";

const isFileLike = (value: unknown): value is File =>
	Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as { name?: unknown }).name === "string" &&
			typeof (value as { size?: unknown }).size === "number",
	);

const getActiveProjectScope = (
	env: EditorActionEnvironment,
): ReactSyncScopeHandle | null => {
	const pageRuntime = env.pageRuntime;
	if (!pageRuntime) {
		return null;
	}
	const rootScope = pageRuntime.getRootScope();
	if (!rootScope) {
		return null;
	}
	return pageRuntime.readOne(rootScope, "activeProject");
};

const getImportPayload = (
	task: RuntimeTaskDescriptor,
): { inputBatchHandleId: string } | null => {
	const data = task.payload.data as { inputBatchHandleId?: unknown } | null;
	return typeof data?.inputBatchHandleId === "string" && data.inputBatchHandleId
		? { inputBatchHandleId: data.inputBatchHandleId }
		: null;
};

const dispatchImportProgress = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	payload: {
		taskId: string;
		stage: "processing" | "done" | "error";
		processed: number;
		total: number;
		error?: string;
	},
): void => {
	env.dkt?.dispatch(
		"setActiveProjectImportProgress",
		payload,
		env.pageRuntime?.getRootScope() ?? projectScope,
	);
};

const resolveImportedResourceNodeId = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	url: string,
): string | null => {
	const resourceScopes = env.pageRuntime?.readMany(projectScope, "resources");
	if (!Array.isArray(resourceScopes)) {
		return null;
	}
	for (let index = resourceScopes.length - 1; index >= 0; index -= 1) {
		const scope = resourceScopes[index];
		const attrs = env.pageRuntime?.readAttrs(scope, ["url"]) as
			| { url?: unknown }
			| undefined;
		if (attrs?.url === url && typeof scope?._nodeId === "string") {
			return scope._nodeId;
		}
	}
	return null;
};

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const waitForImportedResourceNodeId = async (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	url: string,
): Promise<string | null> => {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const resourceId = resolveImportedResourceNodeId(env, projectScope, url);
		if (resourceId) {
			return resourceId;
		}
		await wait(20);
	}
	return null;
};

const projectTimelineHasClips = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
): boolean => {
	const tracks = env.pageRuntime?.readMany(projectScope, "tracks");
	if (!Array.isArray(tracks)) {
		return false;
	}
	return tracks.some((trackScope) => {
		const clips = env.pageRuntime?.readMany(trackScope, "clips");
		return Array.isArray(clips) && clips.length > 0;
	});
};

const waitForProjectTimelineClips = async (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
): Promise<void> => {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (projectTimelineHasClips(env, projectScope)) {
			return;
		}
		await wait(20);
	}
};

export const executeImportFilesTask = async ({
	task,
	env,
	projectScope: providedProjectScope,
}: {
	task: RuntimeTaskDescriptor;
	env: EditorActionEnvironment;
	projectScope?: ReactSyncScopeHandle | null;
}): Promise<void> => {
	if (task.dropped) {
		return;
	}
	const importPayload = getImportPayload(task);
	if (!importPayload) {
		return;
	}
	const { inputBatchHandleId } = importPayload;

	const raw = env.tasks.consumeRuntimeRef(inputBatchHandleId);
	const fileList = Array.isArray(raw) ? raw.filter(isFileLike) : [];
	if (fileList.length === 0) {
		env.tasks.completeTask(task);
		return;
	}

	const projectScope = providedProjectScope ?? getActiveProjectScope(env);
	if (!projectScope || !env.dkt) {
		env.tasks.completeTask(task);
		return;
	}

	const ownerPeerId = env.transfers.getPeerId();
	let processed = 0;

	try {
		dispatchImportProgress(env, projectScope, {
			taskId: inputBatchHandleId,
			stage: "processing",
			processed,
			total: fileList.length,
		});
		for (const file of fileList) {
			const kind = env.media.getFileKind(file);
			if (!kind) {
				processed += 1;
				dispatchImportProgress(env, projectScope, {
					taskId: inputBatchHandleId,
					stage: "processing",
					processed,
					total: fileList.length,
				});
				continue;
			}

			const objectUrl = env.media.createObjectUrl(file);
			if (!objectUrl) {
				processed += 1;
				dispatchImportProgress(env, projectScope, {
					taskId: inputBatchHandleId,
					stage: "processing",
					processed,
					total: fileList.length,
				});
				continue;
			}
			env.lifecycle.registerObjectUrl(objectUrl, "import");

			let duration = 0;
			try {
				duration = await env.media.getImportedResourceDuration(objectUrl, kind);
			} catch {
				duration = 0;
			}

			const mime = file.type || "application/octet-stream";

			env.dkt.dispatch(
				"importResourceIntoActiveProject",
				{
					name: file.name,
					kind,
					url: objectUrl,
					mime,
					duration,
					size: file.size,
					source: {
						kind: "local",
						ownerPeerId:
							typeof ownerPeerId === "string" && ownerPeerId.length > 0
								? ownerPeerId
								: null,
					},
					status: "ready",
					data: {
						status: "ready",
						chunkSize: env.resourceChunkSize,
						chunks: {},
						ranges: { loaded: [[0, file.size]], requested: [] },
						loadedBytes: file.size,
					},
				},
				env.pageRuntime?.getRootScope() ?? projectScope,
			);

			const resourceId = await waitForImportedResourceNodeId(
				env,
				projectScope,
				objectUrl,
			);
			if (!resourceId) {
				processed += 1;
				dispatchImportProgress(env, projectScope, {
					taskId: inputBatchHandleId,
					stage: "processing",
					processed,
					total: fileList.length,
				});
				continue;
			}

			if (!projectTimelineHasClips(env, projectScope)) {
				env.dkt.dispatch(
					"addActiveProjectResourceToTimeline",
					resourceId,
					env.pageRuntime?.getRootScope() ?? projectScope,
				);
				await waitForProjectTimelineClips(env, projectScope);
			}

			env.transfers.manager.registerLocalResource(resourceId, file, {
				objectUrl,
				kind,
				mime,
				duration,
				size: file.size,
				chunkSize: env.resourceChunkSize,
				ownerPeerId,
				sourceKind: "local",
				fallbackUrl: objectUrl,
				name: file.name,
			});
			processed += 1;
			dispatchImportProgress(env, projectScope, {
				taskId: inputBatchHandleId,
				stage: "processing",
				processed,
				total: fileList.length,
			});
		}
		dispatchImportProgress(env, projectScope, {
			taskId: inputBatchHandleId,
			stage: "done",
			processed,
			total: fileList.length,
		});
		env.tasks.completeTask(task);
	} catch (error) {
		dispatchImportProgress(env, projectScope, {
			taskId: inputBatchHandleId,
			stage: "error",
			processed,
			total: fileList.length,
			error: error instanceof Error ? error.message : String(error),
		});
		env.tasks.failTask(task);
	}
};
