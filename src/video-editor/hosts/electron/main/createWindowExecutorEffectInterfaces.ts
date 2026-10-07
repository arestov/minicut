import type { MiniCutEffectInterfaces } from "../../../core/contracts/effectInterfaces";
import { createBrowserEffectInterfaces } from "../../../adapters/web/createBrowserEffectInterfaces";
import { DKT_MSG, type MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";

export type WindowExecutorTarget = {
	send(message: MiniCutDktTransportMessage): void;
};

export type ExecutorWindow = {
	transport: WindowExecutorTarget;
	/** `_node_id` of the window's session root; null before it has bootstrapped. */
	rootNodeId: string | null;
};

export type WindowExecutorEffectInterfacesOptions = {
	/** Live windows, oldest connection first. */
	getWindows(): readonly ExecutorWindow[];
	/** The window that staged an import batch (consumes the record), or null. */
	claimImportWindow(handleId: string): ExecutorWindow | null;
	/** Diagnostics of the browser interface implementation; ignored by default. */
	log?: (message: string, details?: unknown) => void;
	/** An effect had no window to run in. */
	onDropped(type: MiniCutDktTransportMessage["type"], reason: string): void;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/**
 * Configuration A effect interfaces: every effect is delegated to the
 * browser executors in renderer windows, exactly as in Web. Each task goes
 * to ONE window, chosen from what the payload says about its origin:
 *
 * - export: the window whose session root is `request.initiatedBy` (the
 *   session root `_node_id`). Without a match the oldest live window runs it.
 * - import: the window that staged the batch. The batch lives in that
 *   window's runtime-ref store and handle ids are per-window counters, so
 *   main records the owner from the window's own `requestImportFiles`
 *   dispatch. An unknown batch is dropped, never guessed.
 * - playback: the window whose session root is `sessionRootNodeId`; a run
 *   belongs to the session that started it and no other window applies it.
 * - media recovery: the payload names no initiator, so the oldest live
 *   window runs it (a recovery that needs a file chosen in another window
 *   fails there with "runtime-ref-expired").
 *
 * When the target window goes away the next request is routed again; a
 * request in flight in the lost window is not moved.
 */
export const createWindowExecutorEffectInterfaces = ({
	getWindows,
	claimImportWindow,
	log = () => undefined,
	onDropped,
}: WindowExecutorEffectInterfacesOptions): MiniCutEffectInterfaces => {
	const byRootNodeId = (rootNodeId: unknown): ExecutorWindow | null =>
		typeof rootNodeId === "string"
			? (getWindows().find((window) => window.rootNodeId === rootNodeId) ?? null)
			: null;

	const resolveTarget = (
		message: MiniCutDktTransportMessage,
	): { window: ExecutorWindow | null; silent: boolean } => {
		const payload = asRecord((message as { payload?: unknown }).payload);
		switch (message.type) {
			case DKT_MSG.EXPORT_CANCEL_REQUEST: {
				// Same window as the export it cancels; never another window's export.
				const window = byRootNodeId(payload?.initiatedBy);
				return { window, silent: window === null };
			}
			case DKT_MSG.EXPORT_REQUEST: {
				const initiatedBy = asRecord(payload?.request)?.initiatedBy;
				return {
					window: byRootNodeId(initiatedBy) ?? getWindows()[0] ?? null,
					silent: false,
				};
			}
			case DKT_MSG.IMPORT_FILES_REQUEST: {
				const handleId = payload?.inputBatchHandleId;
				return {
					window: typeof handleId === "string" ? claimImportWindow(handleId) : null,
					silent: false,
				};
			}
			case DKT_MSG.PLAYBACK_RUN_REQUEST: {
				const window = byRootNodeId(payload?.sessionRootNodeId);
				// A window that has not bootstrapped yet only gets idle-state runs.
				const pending = getWindows().some((candidate) => candidate.rootNodeId === null);
				return { window, silent: window === null && pending };
			}
			default:
				return { window: getWindows()[0] ?? null, silent: false };
		}
	};

	const target = {
		send(message: MiniCutDktTransportMessage): void {
			const { window, silent } = resolveTarget(message);
			if (!window) {
				if (!silent) onDropped(message.type, "no window owns this task");
				return;
			}
			window.transport.send(message);
		},
	};

	const routed = createBrowserEffectInterfaces({
		pages: new Set([target]),
		log,
	});
	return {
		time: routed.time,
		exportRuntime: routed.exportRuntime,
		mediaRecoveryRuntime: routed.mediaRecoveryRuntime,
		importRuntime: routed.importRuntime,
		playbackRuntime: routed.playbackRuntime,
	};
};
