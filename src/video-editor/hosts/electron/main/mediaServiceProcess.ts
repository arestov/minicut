import type { AssetResolver } from "../../../media/contracts/assets";
import type { MediaErrorInfo } from "../../../media/contracts/errors";
import type {
	MediaRpcClientMessage,
	MediaRpcEndpoint,
	MediaRpcServerMessage,
} from "../../../media/node/rpc/mediaRpcProtocol";
import {
	createMediaServiceClient,
	type MediaServiceClient,
} from "../../../media/node/rpc/mediaServiceClient";

/** The part of Electron's `UtilityProcess` the host uses. */
export type UtilityProcessLike = {
	postMessage(message: unknown): void;
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "exit", listener: (code: number) => void): unknown;
	kill(): boolean;
};

/** The part of `electron.utilityProcess` the host uses. */
export type UtilityProcessApi = {
	fork(
		modulePath: string,
		args?: string[],
		options?: { serviceName?: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" | "ignore" },
	): UtilityProcessLike;
};

export class MediaServiceStartError extends Error {
	readonly info: MediaErrorInfo | null;
	constructor(message: string, info: MediaErrorInfo | null = null) {
		super(message);
		this.name = "MediaServiceStartError";
		this.info = info;
	}
}

export type MediaServiceProcess = {
	/** Calls and jobs run in the utility process; results come back as events. */
	service: MediaServiceClient;
	/**
	 * Idempotent: cancels running jobs (the service kills ffmpeg and removes
	 * temp files), then ends the process. Resolves when it exited.
	 */
	dispose(): Promise<void>;
};

export type StartMediaServiceProcessOptions = {
	utilityProcess: UtilityProcessApi;
	/** Built entry of the service process (`dist-electron/utility/mediaService.mjs`). */
	entryPath: string;
	/** Resolves asset ids for the service; the registry stays in main. */
	assets: AssetResolver;
	env?: NodeJS.ProcessEnv;
	/** The service process ended after it had started. */
	onExit?: (code: number) => void;
};

/** Upper bound for running jobs to confirm their cancel before the process is killed. */
const SHUTDOWN_GRACE_MS = 5_000;

const isServerMessage = (value: unknown): value is MediaRpcServerMessage =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { type?: unknown }).type === "string";

/**
 * Starts the Node media service in an Electron `utilityProcess` and waits for
 * it to be ready (ffmpeg and ffprobe verified). A missing binary or an early
 * exit is a thrown start error, never a silent no-op host.
 */
export const startMediaServiceProcess = async ({
	utilityProcess,
	entryPath,
	assets,
	env,
	onExit,
}: StartMediaServiceProcessOptions): Promise<MediaServiceProcess> => {
	const child = utilityProcess.fork(entryPath, [], {
		serviceName: "minicut-media",
		stdio: "inherit",
		...(env ? { env } : {}),
	});
	const messageListeners = new Set<(message: MediaRpcServerMessage) => void>();
	const closeListeners = new Set<() => void>();
	let exited = false;
	let exitPromiseResolve: () => void = () => undefined;
	const exitPromise = new Promise<void>((resolve) => {
		exitPromiseResolve = resolve;
	});

	const endpoint: MediaRpcEndpoint<MediaRpcServerMessage, MediaRpcClientMessage> = {
		post(message) {
			if (!exited) child.postMessage(message);
		},
		onMessage(listener) {
			messageListeners.add(listener);
			return () => {
				messageListeners.delete(listener);
			};
		},
		onClose(listener) {
			closeListeners.add(listener);
			return () => {
				closeListeners.delete(listener);
			};
		},
	};

	let disposePromise: Promise<void> | null = null;
	let started = false;
	let rejectStart: (error: Error) => void = () => undefined;
	let resolveStart: () => void = () => undefined;
	const startPromise = new Promise<void>((resolve, reject) => {
		resolveStart = resolve;
		rejectStart = reject;
	});

	child.on("message", (message: unknown) => {
		if (!isServerMessage(message)) return;
		if (message.type === "ready") {
			started = true;
			resolveStart();
			return;
		}
		if (message.type === "failed") {
			rejectStart(new MediaServiceStartError(message.error.message, message.error));
			return;
		}
		for (const listener of [...messageListeners]) listener(message);
	});
	child.on("exit", (code: number) => {
		exited = true;
		exitPromiseResolve();
		if (!started) {
			rejectStart(
				new MediaServiceStartError(
					`The media service process exited before it was ready (code ${code})`,
				),
			);
			return;
		}
		for (const listener of [...closeListeners]) listener();
		// An exit the host asked for (dispose) is not news.
		if (!disposePromise) onExit?.(code);
	});

	const service = createMediaServiceClient({ endpoint, assets });
	const dispose = (): Promise<void> => {
		disposePromise ||= (async () => {
			if (!exited) {
				let graceTimer: ReturnType<typeof setTimeout> | undefined;
				await Promise.race([
					service.cancelAll(),
					exitPromise,
					new Promise<void>((resolve) => {
						graceTimer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
					}),
				]);
				clearTimeout(graceTimer);
			}
			service.dispose();
			if (!exited) child.kill();
			await exitPromise;
		})();
		return disposePromise;
	};

	try {
		await startPromise;
	} catch (error) {
		await dispose();
		throw error;
	}
	return { service, dispose };
};
