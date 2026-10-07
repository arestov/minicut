import type { AssetResolution } from "../../contracts/assets";
import type { MediaCapabilities } from "../../contracts/capabilities";
import type { MediaErrorInfo } from "../../contracts/errors";
import type { MediaExportRequest } from "../../contracts/export";
import type { FileArtifact, JobProgressEvent } from "../../contracts/job";
import type { ProbeRequest, ProbeResult } from "../../contracts/probe";
import type { ProxyRequest } from "../../contracts/proxy";

/**
 * Wire protocol between a media service host process (Electron utility
 * process, a worker) and its client. Every message is a plain structured
 * clonable object; neither side imports Electron. The server resolves asset
 * ids by asking the client (the registry lives with the client), so no asset
 * state is duplicated in the service process.
 */

export type MediaRpcCall =
	| { method: "probe"; request: ProbeRequest }
	| { method: "capabilities" }
	| { method: "fingerprint"; filePath: string };

export type MediaRpcCallResult = {
	probe: ProbeResult;
	capabilities: MediaCapabilities;
	fingerprint: { fingerprint: string; version: string };
};

export type MediaRpcJobRequest =
	| { kind: "export"; request: MediaExportRequest }
	| { kind: "proxy"; request: ProxyRequest };

/** client -> server */
export type MediaRpcClientMessage =
	| ({ type: "call"; callId: number } & MediaRpcCall)
	| ({ type: "job-start"; jobId: number } & MediaRpcJobRequest)
	| { type: "job-cancel"; jobId: number }
	| { type: "resolve-result"; resolveId: number; resolution: AssetResolution };

export type MediaRpcCallReply =
	| { ok: true; value: unknown }
	| { ok: false; error: MediaErrorInfo };

/** server -> client */
export type MediaRpcServerMessage =
	| { type: "ready" }
	| { type: "failed"; error: MediaErrorInfo }
	| { type: "call-result"; callId: number; result: MediaRpcCallReply }
	| { type: "job-progress"; jobId: number; event: JobProgressEvent }
	| { type: "job-done"; jobId: number; artifact: FileArtifact }
	| { type: "job-error"; jobId: number; error: MediaErrorInfo }
	| { type: "job-cancelled"; jobId: number }
	| { type: "resolve"; resolveId: number; assetId: string };

/** One end of a message channel: a utility process port, a worker port, a test channel. */
export type MediaRpcEndpoint<TIn, TOut> = {
	post(message: TOut): void;
	/** Returns the unsubscribe function. */
	onMessage(listener: (message: TIn) => void): () => void;
	/** Called once when the other side is gone (process exit, closed port). */
	onClose(listener: () => void): () => void;
};
