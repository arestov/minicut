import type { MiniCutEffectInterfaces } from "../../core/contracts/effectInterfaces";
import { DKT_MSG, type MiniCutDktTransportMessage } from "../../dkt/shared/messageTypes";

type PagePublishTarget = {
	send(message: MiniCutDktTransportMessage): void;
};

export type BrowserEffectInterfacesOptions = {
	/** Connected pages; every effect request is published to all of them. */
	pages: ReadonlySet<PagePublishTarget>;
	log: (message: string, details?: unknown) => void;
};

/**
 * Browser default effect implementations: each effect publishes a task
 * request to the connected pages, where page-side executors run it.
 */
export const createBrowserEffectInterfaces = ({
	pages,
	log,
}: BrowserEffectInterfacesOptions): MiniCutEffectInterfaces => {
	const publishExportRequest = (payload: unknown) => {
		const requestPayload =
			payload && typeof payload === "object"
				? ((payload as { request?: unknown }).request ?? payload)
				: payload;
		const requestId = (requestPayload as { id?: unknown } | null)?.id;
		log("publishExportRequest:attempt", {
			requestId,
			transports: pages.size,
		});

		for (const page of pages) {
			page.send({
				type: DKT_MSG.EXPORT_REQUEST,
				payload,
			} as MiniCutDktTransportMessage);
		}
		log("publishExportRequest:sent", {
			requestId,
			transports: pages.size,
		});
	};

	const publishToPages = (
		type: MiniCutDktTransportMessage["type"],
		payload: unknown,
	) => {
		for (const page of pages) {
			page.send({ type, payload } as MiniCutDktTransportMessage);
		}
	};

	return {
		time: {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			Date: globalThis.Date,
		},
		exportRuntime: {
			requestExport: (payload: unknown) => {
				const requestPayload =
					payload && typeof payload === "object"
						? ((payload as { request?: unknown }).request ?? payload)
						: payload;
				log("exportRuntime.requestExport", {
					requestId: (requestPayload as { id?: unknown } | null)?.id,
				});
				publishExportRequest(payload);
			},
			cancelExport: (payload: unknown) => {
				log("exportRuntime.cancelExport", {
					requestId: (payload as { id?: unknown } | null)?.id,
				});
				publishToPages(DKT_MSG.EXPORT_CANCEL_REQUEST, payload);
			},
		},
		importRuntime: {
			requestImportFiles: (payload: unknown) => {
				publishToPages(DKT_MSG.IMPORT_FILES_REQUEST, payload);
			},
		},
		mediaRecoveryRuntime: {
			publishMediaPublicationDecision: (payload) => publishToPages(DKT_MSG.MEDIA_PUBLICATION_DECISION, payload),
			releaseMediaPublication: (payload) => publishToPages(DKT_MSG.MEDIA_PUBLICATION_RETIREMENT, payload),
			requestMediaRecovery: (payload: unknown) => {
				publishToPages(DKT_MSG.MEDIA_RECOVERY_REQUEST, payload);
			},
		},
		playbackRuntime: {
			applyPlaybackRun: (payload: unknown) => {
				publishToPages(DKT_MSG.PLAYBACK_RUN_REQUEST, payload);
			},
		},
	};
};
