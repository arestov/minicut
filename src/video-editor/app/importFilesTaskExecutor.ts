import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import type { MediaImportEntry } from "./actionRuntimeTypes";
import type { EditorActionEnvironment } from "./editorActionEnvironment";
import type { RuntimeTaskDescriptor } from "./runtimeTaskFacade";

const isFileLike = (value: unknown): value is File => Boolean(value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string" && typeof (value as { size?: unknown }).size === "number");
const normalize = (value: MediaImportEntry | unknown): { file: File; handle: FileSystemFileHandle | null } | null => {
	if (isFileLike(value)) return { file: value, handle: null };
	if (value && typeof value === "object" && isFileLike((value as { file?: unknown }).file)) {
		const handle = (value as { handle?: unknown }).handle;
		return { file: (value as { file: File }).file, handle: handle && typeof handle === "object" ? handle as FileSystemFileHandle : null };
	}
	return null;
};
const payloadOf = (task: RuntimeTaskDescriptor) => {
	const data = task.payload.data as {
		inputBatchHandleId?: unknown;
		addToTimelineWhenEmpty?: unknown;
	} | null;
	return typeof data?.inputBatchHandleId === "string" && data.inputBatchHandleId
		? {
				inputBatchHandleId: data.inputBatchHandleId,
				addToTimelineWhenEmpty: data.addToTimelineWhenEmpty !== false,
			}
		: null;
};
const activeProject = (env: EditorActionEnvironment) => {
	const root = env.pageRuntime?.getRootScope(); return root ? env.pageRuntime?.readOne(root, "activeProject") ?? null : null;
};
const progress = (env: EditorActionEnvironment, project: ReactSyncScopeHandle, value: unknown) => env.dkt?.dispatch("setActiveProjectImportProgress", value, env.pageRuntime?.getRootScope() ?? project);

/**
 * Browser work happens before the write. Each file then enters DKT exactly once:
 * Project creates the Resource and the owned recovery task in one declarative flow.
 */
export const executeImportFilesTask = async ({ task, env, projectScope: supplied }: { task: RuntimeTaskDescriptor; env: EditorActionEnvironment; projectScope?: ReactSyncScopeHandle | null }): Promise<void> => {
	if (task.dropped) return;
	const importPayload = payloadOf(task); if (!importPayload) return;
	const { inputBatchHandleId: batchRef, addToTimelineWhenEmpty } = importPayload;
	const raw = env.tasks.consumeRuntimeRef(batchRef);
	const entries = Array.isArray(raw) ? raw.flatMap((entry) => { const item = normalize(entry); return item ? [item] : []; }) : [];
	if (!entries.length) { env.tasks.completeTask(task); return; }
	const project = supplied ?? activeProject(env); if (!project || !env.dkt) { env.tasks.completeTask(task); return; }
	let processed = 0;
	try {
		progress(env, project, { taskId: batchRef, stage: "processing", processed, total: entries.length });
		for (const { file, handle } of entries) {
			const kind = env.media.getFileKind(file); if (!kind) { processed += 1; continue; }
			const objectUrl = env.media.createObjectUrl(file); if (!objectUrl) { processed += 1; continue; }
			env.lifecycle.registerObjectUrl(objectUrl, "import");
			let duration = 0; try { duration = await env.media.getImportedResourceDuration(objectUrl, kind); } catch { /* unknown duration remains zero */ }
			// Only a video can carry an embedded audio clip; null stays "unknown".
			let audio: Awaited<ReturnType<NonNullable<typeof env.media.probeAudioStreams>>> = null;
			if (kind === "video") { try { audio = (await env.media.probeAudioStreams?.(file)) ?? null; } catch { /* unknown audio streams */ } }
			const audioStreams = kind === "audio" ? 1 : (audio?.audioStreams ?? null);
			let contentFingerprint: string | null = null; let fingerprintVersion: string | null = null;
			try { const result = await env.media.fingerprintFile?.(file); if (result) { contentFingerprint = result.fingerprint; fingerprintVersion = result.version; } } catch { /* degraded identity */ }
			const operationId = crypto.randomUUID(); const attemptId = crypto.randomUUID(); const bootId = `import:${batchRef}`;
			const runtimeHandleId = env.tasks.putRuntimeRef({ file, handle });
			const ownerPeerId = env.transfers.getPeerId(); const mime = file.type || "application/octet-stream";
			await env.dkt.dispatchAndWait("importResource", {
				name: file.name, kind, url: objectUrl, mime, duration, size: file.size, lastModified: file.lastModified,
				addToTimelineWhenEmpty, audioStreams,
				sourceKind: handle ? "file-handle" : "object-url", sourceRef: null, source: { kind: "local", ownerPeerId }, status: "ready",
				data: { status: "ready", chunkSize: env.resourceChunkSize, chunks: {}, ranges: { loaded: [[0, file.size]], requested: [] }, loadedBytes: file.size },
				assetStorageKind: "linked", assetRef: null, contentFingerprint, fingerprintVersion, localMediaStatus: handle ? "ready-file-handle" : "unknown",
				localMediaAvailability: handle ? "ready-file-handle" : "unknown", originalAccessStatus: handle ? "granted" : "missing",
				operationId, attemptId, bootId, recoveryKind: "import", intent: "restore", runtimeHandleId,
				original: { kind, duration, frameRate: null, timebase: null, width: null, height: null, audioChannels: audio?.audioChannels ?? null, audioSampleRate: audio?.audioSampleRate ?? null, streams: { videoStreams: kind === "video" ? 1 : 0, audioStreams } },
				requiredSourceEnd: duration, originalFingerprint: contentFingerprint, createdAt: Date.now(), updatedAt: Date.now(),
			}, project);
			processed += 1; progress(env, project, { taskId: batchRef, stage: "processing", processed, total: entries.length });
		}
		progress(env, project, { taskId: batchRef, stage: "done", processed, total: entries.length }); env.tasks.completeTask(task);
	} catch (error) {
		progress(env, project, { taskId: batchRef, stage: "error", processed, total: entries.length, error: error instanceof Error ? error.message : String(error) }); env.tasks.failTask(task);
	}
};
