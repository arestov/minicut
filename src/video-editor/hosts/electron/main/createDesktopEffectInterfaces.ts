import type { MiniCutEffectInterfaces } from "../../../core/contracts/effectInterfaces";
import { createBrowserEffectInterfaces } from "../../../adapters/web/createBrowserEffectInterfaces";
import type { MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";

export type EffectTarget = {
	send(message: MiniCutDktTransportMessage): void;
};

export type ExecutorWindow = {
	transport: EffectTarget;
	/** `_node_id` of the window's session root; null before it has bootstrapped. */
	rootNodeId: string | null;
};

/** The main-process executors that run the tasks the model requests (config B). */
export type DesktopEffectSink = {
	requestExport(payload: unknown): void;
	cancelExport(payload: unknown): void;
	requestImportFiles(payload: unknown): void;
	requestMediaRecovery(payload: unknown): void;
	publishMediaPublicationDecision(payload: unknown): void;
	releaseMediaPublication(payload: unknown): void;
};

export type DesktopEffectInterfacesOptions = {
	/**
	 * The executors, bound after the runtime exists. Until they are, requests
	 * are reported as dropped, never silently ignored.
	 */
	sink(): DesktopEffectSink | null;
	/** Live windows, oldest connection first. */
	getWindows(): readonly ExecutorWindow[];
	/** Diagnostics of the browser interface implementation; ignored by default. */
	log?: (message: string, details?: unknown) => void;
	/** An effect had no owner to run it. */
	onDropped(effect: string, reason: string): void;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/**
 * Configuration B effect interfaces. Export, import and media recovery go to
 * the executors in the main process, which run them on the Node media
 * service in the utility process; renderer windows never receive these
 * tasks. Playback stays a browser executor (WebAudio) in the renderer: a run
 * belongs to the window whose session root is `sessionRootNodeId` and no
 * other window applies it. The platform also restores media of attended
 * projects at boot through the regular media recovery effect.
 *
 * When the playback window goes away the next request is routed again; a
 * request in flight in the lost window is not moved.
 */
export const createDesktopEffectInterfaces = ({
	sink,
	getWindows,
	log = () => undefined,
	onDropped,
}: DesktopEffectInterfacesOptions): MiniCutEffectInterfaces => {
	const toSink = (effect: string, run: (target: DesktopEffectSink) => void): void => {
		const target = sink();
		if (!target) {
			onDropped(effect, "the desktop executors are not running");
			return;
		}
		run(target);
	};

	const windowTarget: EffectTarget = {
		send(message) {
			const payload = asRecord((message as { payload?: unknown }).payload);
			const rootNodeId = payload?.sessionRootNodeId;
			const windows = getWindows();
			const window =
				typeof rootNodeId === "string"
					? (windows.find((candidate) => candidate.rootNodeId === rootNodeId) ?? null)
					: null;
			if (window) {
				window.transport.send(message);
				return;
			}
			// A window that has not bootstrapped yet only gets idle-state runs.
			const pending = windows.some((candidate) => candidate.rootNodeId === null);
			if (!pending) onDropped(message.type, "no window owns this task");
		},
	};
	const windowEffects = createBrowserEffectInterfaces({
		pages: new Set([windowTarget]),
		log,
	});

	return {
		time: windowEffects.time,
		exportRuntime: {
			requestExport: (payload) =>
				toSink("exportRuntime.requestExport", (target) => target.requestExport(payload)),
			cancelExport: (payload) =>
				toSink("exportRuntime.cancelExport", (target) => target.cancelExport(payload)),
		},
		importRuntime: {
			requestImportFiles: (payload) =>
				toSink("importRuntime.requestImportFiles", (target) =>
					target.requestImportFiles(payload),
				),
		},
		mediaRecoveryRuntime: {
			publishMediaPublicationDecision: (payload) => toSink("mediaRecoveryRuntime.publishMediaPublicationDecision", (target) => target.publishMediaPublicationDecision(payload)),
			releaseMediaPublication: (payload) => toSink("mediaRecoveryRuntime.releaseMediaPublication", (target) => target.releaseMediaPublication(payload)),
			requestMediaRecovery: (payload) =>
				toSink("mediaRecoveryRuntime.requestMediaRecovery", (target) =>
					target.requestMediaRecovery(payload),
				),
		},
		playbackRuntime: windowEffects.playbackRuntime,
		mediaRestoreRuntime: { restoresMediaAtBoot: true },
	};
};
