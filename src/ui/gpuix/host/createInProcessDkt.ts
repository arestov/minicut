import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { MiniCutEffectInterfaces } from "../../../video-editor/core/contracts/effectInterfaces";
import {
	createEffectContractFakes,
	type EffectContractFakes,
} from "../../../video-editor/dkt/test/effectContractFakes";
import { createMiniCutDktRuntime } from "../../../video-editor/dkt/runtime/createMiniCutDktRuntime";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { createInProcessTransportPair } from "../../../video-editor/hosts/desktop/inProcessTransport";

export type InProcessDkt = {
	/** The page sync runtime the Solid binding (`RootScope`) consumes. */
	pageRuntime: PageSyncRuntime;
	/**
	 * The recording effect fakes the runtime runs with (undefined when the host
	 * supplied its own interfaces). They record requests and never report
	 * results; no executor exists in this host.
	 */
	fakes: EffectContractFakes | null;
	destroy(): void;
};

/**
 * Boots the real MiniCut DKT runtime on memory storage inside this process
 * and connects a page sync runtime to it over an in-memory transport.
 * (A worker transport replaces this in stage 5.)
 */
export const createInProcessDkt = (
	options: {
		sessionKey?: string;
		/** Defaults to the contract fakes: external executors are not part of the fixtures. */
		effectInterfaces?: MiniCutEffectInterfaces;
	} = {},
): InProcessDkt => {
	const fakes = options.effectInterfaces ? null : createEffectContractFakes();
	const effectInterfaces = options.effectInterfaces ?? fakes!.interfaces;
	const dktRuntime = createMiniCutDktRuntime({
		enabled: true,
		effectInterfaces,
		crdt: { enabled: true, testOnly: true, storage: "memory", transport: null },
	});
	const { page, runtime } = createInProcessTransportPair();
	const connection = dktRuntime.connect(runtime);
	const pageRuntime = createMiniCutPageSyncRuntime({ transport: page });

	pageRuntime.bootstrap({ sessionKey: options.sessionKey ?? "gpuix-fixture" });

	return {
		pageRuntime,
		fakes,
		destroy() {
			pageRuntime.destroy();
			connection.destroy();
		},
	};
};
