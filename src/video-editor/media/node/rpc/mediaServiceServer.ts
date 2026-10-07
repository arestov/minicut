import type { AssetResolution, AssetResolver } from "../../contracts/assets";
import type { FileArtifact, MediaJob } from "../../contracts/job";
import { toMediaErrorInfo } from "../mediaError";
import type { MediaService } from "../mediaService";
import type {
	MediaRpcCallReply,
	MediaRpcClientMessage,
	MediaRpcEndpoint,
	MediaRpcServerMessage,
} from "./mediaRpcProtocol";

export type MediaServiceServerOptions = {
	endpoint: MediaRpcEndpoint<MediaRpcClientMessage, MediaRpcServerMessage>;
	/**
	 * Builds the service. The resolver it receives asks the client to resolve
	 * asset ids; the service never reads a registry of its own.
	 */
	createService(resolver: AssetResolver): MediaService;
	fingerprint(filePath: string): Promise<{ fingerprint: string; version: string }>;
};

export type MediaServiceServer = {
	/** Cancels running jobs and detaches from the endpoint. */
	dispose(): void;
};

/**
 * Serves a MediaService over an endpoint. Runs inside the service process;
 * it holds no model state: every request carries what the job needs and
 * every result goes back as its own message.
 */
export const serveMediaService = ({
	endpoint,
	createService,
	fingerprint,
}: MediaServiceServerOptions): MediaServiceServer => {
	let resolveSequence = 0;
	const pendingResolves = new Map<number, (resolution: AssetResolution) => void>();
	const jobs = new Map<number, MediaJob<FileArtifact>>();

	const resolver: AssetResolver = {
		resolve: (assetId) =>
			new Promise<AssetResolution>((resolve) => {
				const resolveId = (resolveSequence += 1);
				pendingResolves.set(resolveId, resolve);
				endpoint.post({ type: "resolve", resolveId, assetId });
			}),
	};
	const service = createService(resolver);

	const startJob = (jobId: number, job: MediaJob<FileArtifact>): void => {
		jobs.set(jobId, job);
		job.onProgress((event) => endpoint.post({ type: "job-progress", jobId, event }));
		void job.outcome.then((outcome) => {
			jobs.delete(jobId);
			if (outcome.status === "done") {
				endpoint.post({ type: "job-done", jobId, artifact: outcome.artifact });
			} else if (outcome.status === "error") {
				endpoint.post({ type: "job-error", jobId, error: outcome.error });
			} else {
				endpoint.post({ type: "job-cancelled", jobId });
			}
		});
	};

	const stopMessages = endpoint.onMessage((message) => {
		switch (message.type) {
			case "call": {
				const reply = (result: MediaRpcCallReply) =>
					endpoint.post({ type: "call-result", callId: message.callId, result });
				const run: Promise<unknown> =
					message.method === "probe"
						? service.probe(message.request)
						: message.method === "capabilities"
							? service.capabilities()
							: fingerprint(message.filePath);
				run.then(
					(value) => reply({ ok: true, value }),
					(error: unknown) => reply({ ok: false, error: toMediaErrorInfo(error) }),
				);
				return;
			}
			case "job-start":
				startJob(
					message.jobId,
					message.kind === "export"
						? service.exportPlan(message.request)
						: service.generateProxy(message.request),
				);
				return;
			case "job-cancel":
				jobs.get(message.jobId)?.cancel();
				return;
			case "resolve-result": {
				const pending = pendingResolves.get(message.resolveId);
				pendingResolves.delete(message.resolveId);
				pending?.(message.resolution);
				return;
			}
		}
	});

	return {
		dispose() {
			stopMessages();
			for (const job of [...jobs.values()]) job.cancel();
		},
	};
};
