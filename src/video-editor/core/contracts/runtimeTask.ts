export type RuntimeTaskQueuePolicy =
	| "replace-last"
	| "queue-all"
	| "keep-first";

export interface DispatchRuntimeTaskPayload {
	runtimeRef?: unknown;
	data?: unknown;
}

export interface DispatchRuntimeTaskOptions {
	queuePolicy?: RuntimeTaskQueuePolicy;
	intentKey?: string;
}

export interface RuntimeTaskDescriptor {
	taskId: string;
	fxName: `$fx_${string}`;
	payload: {
		runtimeHandleId?: string;
		data?: unknown;
	};
	queuePolicy: RuntimeTaskQueuePolicy;
	intentKey: string;
	dropped: boolean;
	replacedTaskId?: string;
}

export interface RuntimeTaskDebugDumpTesting {
	active: RuntimeTaskDescriptor[];
	completed: number;
	failed: number;
	dropped: number;
	byFxName: Record<string, number>;
}
