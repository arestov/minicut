import type { MiniCutEffectInterfaces } from "../../core/contracts/effectInterfaces";
import type { DktTestContext } from "../testingInit";

type ModelHandle = DktTestContext["sessionRoot"];

export type RecordedCall = Record<string, unknown>;

/**
 * Recording fake for one effect interface method. It only records the call;
 * it never reports a result itself. Results are delivered later by the test,
 * through the task protocol driver, as separate input steps.
 */
const createRecorder = () => {
	const calls: RecordedCall[] = [];
	return {
		calls,
		record: (payload: unknown): void => {
			calls.push(payload as RecordedCall);
		},
	};
};

export type EffectContractFakes = ReturnType<typeof createEffectContractFakes>;

export const createEffectContractFakes = () => {
	const exportRuntime = createRecorder();
	const importRuntime = createRecorder();
	const mediaRecoveryRuntime = createRecorder();
	const playbackRuntime = createRecorder();

	const interfaces: MiniCutEffectInterfaces = {
		exportRuntime: { requestExport: exportRuntime.record },
		importRuntime: { requestImportFiles: importRuntime.record },
		mediaRecoveryRuntime: { requestMediaRecovery: mediaRecoveryRuntime.record },
		playbackRuntime: { applyPlaybackRun: playbackRuntime.record },
	};

	return {
		interfaces,
		exportCalls: exportRuntime.calls,
		importCalls: importRuntime.calls,
		mediaRecoveryCalls: mediaRecoveryRuntime.calls,
		playbackCalls: playbackRuntime.calls,
	};
};

type ExportStage = "queued" | "rendering" | "finalizing" | "done" | "error";

/**
 * Delivers task results the way page-side executors do: each progress,
 * completion or failure is its own dispatch (own input step) of a declared
 * action, called by the test after the effect fake has recorded its call.
 */
export const createTaskProtocolDriver = (ctx: DktTestContext) => {
	const send = async (
		scope: ModelHandle,
		actionName: string,
		payload: unknown,
	): Promise<void> => {
		await ctx.lockToRead(async () => {
			await scope.dispatch(actionName, payload);
		});
	};

	return {
		export: {
			progress: (
				request: RecordedCall,
				stage: ExportStage,
				progress: number,
				extra: Record<string, unknown> = {},
			) =>
				send(ctx.sessionRoot, "setExportProgress", {
					id: request.id,
					range: request.range,
					stage,
					progress,
					updatedAt: 1,
					initiatedBy: request.initiatedBy,
					...extra,
				}),
			consume: (request: RecordedCall) =>
				send(ctx.sessionRoot, "consumeExportRequest", { id: request.id }),
		},
		import: {
			progress: (
				taskId: string,
				stage: "queued" | "processing" | "done" | "error",
				processed: number,
				total: number,
				error?: string,
			) =>
				send(ctx.sessionRoot, "setActiveProjectImportProgress", {
					taskId,
					stage,
					processed,
					total,
					...(error ? { error } : {}),
				}),
		},
		mediaRecovery: {
			inspected: (task: ModelHandle, payload: Record<string, unknown>) =>
				send(task, "recordInspection", payload),
			transition: (task: ModelHandle, payload: Record<string, unknown>) =>
				send(task, "transition", payload),
		},
		playback: {
			complete: (runId: number, cursor: number) =>
				send(ctx.sessionRoot, "completePlayback", { runId, cursor }),
		},
	};
};
