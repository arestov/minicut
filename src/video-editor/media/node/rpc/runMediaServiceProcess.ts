import { fingerprintNodeFile } from "../../../adapters/node/nodeFileFingerprint";
import type { MediaErrorInfo } from "../../contracts/errors";
import { type MediaBinaries, resolveMediaBinaries } from "../binaries";
import { createMediaService } from "../mediaService";
import { runCaptured } from "../processRunner";
import type {
	MediaRpcClientMessage,
	MediaRpcEndpoint,
	MediaRpcServerMessage,
} from "./mediaRpcProtocol";
import { type MediaServiceServer, serveMediaService } from "./mediaServiceServer";

export type RunMediaServiceProcessOptions = {
	endpoint: MediaRpcEndpoint<MediaRpcClientMessage, MediaRpcServerMessage>;
	/** Defaults to the MINICUT_FFMPEG_PATH / MINICUT_FFPROBE_PATH env or PATH. */
	binaries?: Partial<MediaBinaries>;
	maxConcurrentJobs?: number;
};

const binaryError = (label: string, command: string, envName: string, cause: unknown): MediaErrorInfo => ({
	code: "binary-not-found",
	message: `${label} was not found or does not run (${command}). Install FFmpeg and put ${label} on PATH, or set ${envName} to its full path.`,
	details: { command, cause: cause instanceof Error ? cause.message : String(cause) },
});

const checkBinary = async (
	label: string,
	command: string,
	envName: string,
): Promise<MediaErrorInfo | null> => {
	try {
		const result = await runCaptured(command, ["-version"], { timeoutMs: 10_000 });
		if (result.exitCode !== 0) throw new Error(`exit code ${result.exitCode}`);
		return null;
	} catch (error) {
		return binaryError(label, command, envName, error);
	}
};

/**
 * Body of a media service process (Electron utility process, worker, test
 * child): verifies ffmpeg/ffprobe, announces `ready` or `failed`, then serves
 * the Node media service over the endpoint. No Electron import: the entry
 * point adapts its channel to an endpoint.
 */
export const runMediaServiceProcess = async ({
	endpoint,
	binaries: binaryOptions,
	maxConcurrentJobs,
}: RunMediaServiceProcessOptions): Promise<MediaServiceServer | null> => {
	const binaries = resolveMediaBinaries(binaryOptions);
	const failure =
		(await checkBinary("ffmpeg", binaries.ffmpegPath, "MINICUT_FFMPEG_PATH")) ??
		(await checkBinary("ffprobe", binaries.ffprobePath, "MINICUT_FFPROBE_PATH"));
	if (failure) {
		endpoint.post({ type: "failed", error: failure });
		return null;
	}
	const server = serveMediaService({
		endpoint,
		createService: (assetResolver) =>
			createMediaService({ ...binaries, assetResolver, maxConcurrentJobs }),
		fingerprint: (filePath) => fingerprintNodeFile(filePath),
	});
	endpoint.post({ type: "ready" });
	return server;
};
