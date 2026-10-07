import type { AssetResolver } from "../../contracts/assets";
import type { MediaErrorInfo } from "../../contracts/errors";
import type { FileArtifact, MediaJob } from "../../contracts/job";
import { MediaError } from "../mediaError";
import { MediaJobController } from "../mediaJob";
import type { MediaService } from "../mediaService";
import type {
	MediaRpcCall,
	MediaRpcCallResult,
	MediaRpcClientMessage,
	MediaRpcEndpoint,
	MediaRpcJobRequest,
	MediaRpcServerMessage,
} from "./mediaRpcProtocol";

/** The media service as the desktop host uses it: the service plus content fingerprints. */
export type DesktopMediaService = MediaService & {
	fingerprint(filePath: string): Promise<{ fingerprint: string; version: string }>;
};

export type MediaServiceClientOptions = {
	endpoint: MediaRpcEndpoint<MediaRpcServerMessage, MediaRpcClientMessage>;
	/** Answers the service's asset lookups; the registry stays on this side. */
	assets: AssetResolver;
};

export type MediaServiceClient = DesktopMediaService & {
	/**
	 * Cancels every running job and resolves once the service confirmed each
	 * one (ffmpeg killed, temp files removed). Does not stop the process.
	 */
	cancelAll(): Promise<void>;
	/** Fails what is in flight and detaches. Does not stop the process. */
	dispose(): void;
};

export const MEDIA_SERVICE_STOPPED: MediaErrorInfo = {
	code: "process-failed",
	message: "The media service process stopped",
	details: { reason: "service-stopped" },
};

const toError = (info: MediaErrorInfo): MediaError =>
	new MediaError(info.code, info.message, info.details);

/**
 * Client of a media service in another process. Each job is a MediaJob whose
 * events are the service's own messages (progress, done, error, cancelled);
 * cancel() asks the service to kill its ffmpeg. When the service process goes
 * away every pending call and job fails explicitly.
 */
export const createMediaServiceClient = ({
	endpoint,
	assets,
}: MediaServiceClientOptions): MediaServiceClient => {
	let callSequence = 0;
	let jobSequence = 0;
	let closed = false;
	const calls = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void }
	>();
	const jobs = new Map<number, MediaJobController<FileArtifact>>();

	const settleAll = (): void => {
		closed = true;
		for (const pending of [...calls.values()]) {
			pending.reject(toError(MEDIA_SERVICE_STOPPED));
		}
		calls.clear();
		for (const job of [...jobs.values()]) job.fail(MEDIA_SERVICE_STOPPED);
		jobs.clear();
	};

	const stopMessages = endpoint.onMessage((message) => {
		switch (message.type) {
			case "call-result": {
				const pending = calls.get(message.callId);
				calls.delete(message.callId);
				if (!pending) return;
				if (message.result.ok) pending.resolve(message.result.value);
				else pending.reject(toError(message.result.error));
				return;
			}
			case "job-progress":
				jobs.get(message.jobId)?.emitProgress({
					stage: message.event.stage,
					ratio: message.event.ratio,
				});
				return;
			case "job-done":
				jobs.get(message.jobId)?.done(message.artifact);
				jobs.delete(message.jobId);
				return;
			case "job-error":
				jobs.get(message.jobId)?.fail(message.error);
				jobs.delete(message.jobId);
				return;
			case "job-cancelled":
				jobs.get(message.jobId)?.cancelled();
				jobs.delete(message.jobId);
				return;
			case "resolve":
				void Promise.resolve(assets.resolve(message.assetId)).then(
					(resolution) =>
						endpoint.post({
							type: "resolve-result",
							resolveId: message.resolveId,
							resolution,
						}),
					(error: unknown) =>
						endpoint.post({
							type: "resolve-result",
							resolveId: message.resolveId,
							resolution: {
								ok: false,
								error: {
									code: "asset-unreadable",
									message: error instanceof Error ? error.message : String(error),
									details: { assetId: message.assetId },
								},
							},
						}),
				);
				return;
			case "ready":
			case "failed":
				return;
		}
	});
	const stopClose = endpoint.onClose(settleAll);

	const call = <TMethod extends MediaRpcCall["method"]>(
		request: Extract<MediaRpcCall, { method: TMethod }>,
	): Promise<MediaRpcCallResult[TMethod]> => {
		if (closed) return Promise.reject(toError(MEDIA_SERVICE_STOPPED));
		const callId = (callSequence += 1);
		return new Promise((resolve, reject) => {
			calls.set(callId, { resolve: resolve as (value: unknown) => void, reject });
			endpoint.post({ type: "call", callId, ...request } as MediaRpcClientMessage);
		});
	};

	const startJob = (
		requestId: string,
		jobRequest: MediaRpcJobRequest,
	): MediaJob<FileArtifact> => {
		const job = new MediaJobController<FileArtifact>(requestId);
		if (closed) {
			job.fail(MEDIA_SERVICE_STOPPED);
			return job;
		}
		const jobId = (jobSequence += 1);
		jobs.set(jobId, job);
		job.setCancelHandler(() => {
			if (!closed) endpoint.post({ type: "job-cancel", jobId });
		});
		endpoint.post({ type: "job-start", jobId, ...jobRequest });
		return job;
	};

	return {
		probe: (request) => call({ method: "probe", request }),
		capabilities: () => call({ method: "capabilities" }),
		fingerprint: (filePath) => call({ method: "fingerprint", filePath }),
		exportPlan: (request) =>
			startJob(request.requestId, { kind: "export", request }),
		generateProxy: (request) =>
			startJob(request.requestId, { kind: "proxy", request }),
		async cancelAll() {
			const running = [...jobs.values()];
			for (const job of running) job.cancel();
			await Promise.all(running.map((job) => job.outcome));
		},
		dispose() {
			stopMessages();
			stopClose();
			settleAll();
		},
	};
};
