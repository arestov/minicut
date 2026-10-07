import { describe, expect, it } from "vitest";
import { assertEffectInterfacesComplete } from "../../../core/bootstrap/assertEffectInterfaces";
import { DKT_MSG, type MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";
import {
	createDesktopEffectInterfaces,
	type DesktopEffectInterfacesOptions,
	type DesktopEffectSink,
} from "./createDesktopEffectInterfaces";

const createTargets = () => {
	const windowMessages: { to: string; type: string }[] = [];
	const sinkCalls: { call: string; payload: unknown }[] = [];
	const sink: DesktopEffectSink = {
		requestExport: (payload) => sinkCalls.push({ call: "requestExport", payload }),
		cancelExport: (payload) => sinkCalls.push({ call: "cancelExport", payload }),
		requestImportFiles: (payload) => sinkCalls.push({ call: "requestImportFiles", payload }),
		requestMediaRecovery: (payload) => sinkCalls.push({ call: "requestMediaRecovery", payload }),
	};
	const window = (name: string, rootNodeId: string | null) => ({
		rootNodeId,
		transport: {
			send: (message: MiniCutDktTransportMessage) => {
				windowMessages.push({ to: name, type: message.type });
			},
		},
	});
	return { windowMessages, sinkCalls, sink, a: window("a", "root-a"), b: window("b", "root-b") };
};

const create = (
	targets: ReturnType<typeof createTargets>,
	extra: Partial<DesktopEffectInterfacesOptions> = {},
) =>
	createDesktopEffectInterfaces({
		sink: () => targets.sink,
		getWindows: () => [targets.a, targets.b],
		onDropped: () => undefined,
		...extra,
	});

describe("desktop effect interfaces (configuration B)", () => {
	it("is a complete set for the host, including the boot media restore", () => {
		const interfaces = create(createTargets());

		expect(() => assertEffectInterfacesComplete(interfaces)).not.toThrow();
		expect(interfaces.mediaRestoreRuntime).toEqual({ restoresMediaAtBoot: true });
	});

	it("sends export, import and media recovery to the executors and never to a window", () => {
		const targets = createTargets();
		const interfaces = create(targets);

		interfaces.exportRuntime.requestExport({ request: { id: "e1", initiatedBy: "root-b" } });
		interfaces.exportRuntime.cancelExport({ id: "e1", queueKey: "project", initiatedBy: "root-b" });
		interfaces.importRuntime.requestImportFiles({ inputBatchHandleId: "b1" });
		interfaces.mediaRecoveryRuntime.requestMediaRecovery({ taskId: "t1" });

		expect(targets.sinkCalls.map((entry) => entry.call)).toEqual([
			"requestExport",
			"cancelExport",
			"requestImportFiles",
			"requestMediaRecovery",
		]);
		expect(targets.sinkCalls[2].payload).toEqual({ inputBatchHandleId: "b1" });
		expect(targets.windowMessages).toEqual([]);
	});

	it("reports a request instead of losing it while the executors are not bound", () => {
		const targets = createTargets();
		const dropped: string[] = [];
		const interfaces = create(targets, {
			sink: () => null,
			onDropped: (effect) => dropped.push(effect),
		});

		interfaces.exportRuntime.requestExport({});
		interfaces.mediaRecoveryRuntime.requestMediaRecovery({});

		expect(dropped).toEqual([
			"exportRuntime.requestExport",
			"mediaRecoveryRuntime.requestMediaRecovery",
		]);
	});

	it("keeps playback in the window whose session started the run", () => {
		const targets = createTargets();
		const interfaces = create(targets);

		interfaces.playbackRuntime.applyPlaybackRun({ sessionRootNodeId: "root-b", run: null });

		expect(targets.windowMessages).toEqual([{ to: "b", type: DKT_MSG.PLAYBACK_RUN_REQUEST }]);
		expect(targets.sinkCalls).toEqual([]);
	});

	it("drops playback without an owning window, silently only while a window is still booting", () => {
		const targets = createTargets();
		const dropped: string[] = [];
		const booting = { ...targets.b, rootNodeId: null };
		const whileBooting = create(targets, {
			getWindows: () => [targets.a, booting],
			onDropped: (type) => dropped.push(type),
		});
		const settled = create(targets, { onDropped: (type) => dropped.push(type) });

		whileBooting.playbackRuntime.applyPlaybackRun({ sessionRootNodeId: "root-x", run: null });
		settled.playbackRuntime.applyPlaybackRun({ sessionRootNodeId: "root-x", run: null });

		expect(targets.windowMessages).toEqual([]);
		expect(dropped).toEqual([DKT_MSG.PLAYBACK_RUN_REQUEST]);
	});
});
