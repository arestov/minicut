export type RuntimeTaskQueuePolicy = 'replace-last' | 'queue-all' | 'keep-first'

export interface DispatchRuntimeTaskPayload {
	runtimeRef?: unknown
	data?: unknown
}

export interface DispatchRuntimeTaskOptions {
	queuePolicy?: RuntimeTaskQueuePolicy
	intentKey?: string
}

export interface RuntimeTaskDescriptor {
	taskId: string
	fxName: `$fx_${string}`
	payload: {
		runtimeRefId?: string
		data?: unknown
	}
	queuePolicy: RuntimeTaskQueuePolicy
	intentKey: string
	dropped: boolean
	replacedTaskId?: string
}

interface RuntimeRefRecord {
	value: unknown
}

const isSerializable = (value: unknown): boolean => {
	if (value === null) {
		return true
	}

	const valueType = typeof value
	if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
		return true
	}
	if (valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') {
		return false
	}

	if (Array.isArray(value)) {
		return value.every((item) => isSerializable(item))
	}

	if (valueType === 'object') {
		for (const entry of Object.values(value as Record<string, unknown>)) {
			if (!isSerializable(entry)) {
				return false
			}
		}
		return true
	}

	return false
}

export const createRuntimeTaskFacade = () => {
	let taskSeq = 0
	let runtimeRefSeq = 0
	const runtimeRefs = new Map<string, RuntimeRefRecord>()
	const queuedTaskByIntent = new Map<string, string>()
	const taskRuntimeRef = new Map<string, string>()

	const putRuntimeRef = (value: unknown): string => {
		runtimeRefSeq += 1
		const runtimeRefId = `rt_tmp_${runtimeRefSeq}`
		runtimeRefs.set(runtimeRefId, { value })
		return runtimeRefId
	}

	const consumeRuntimeRef = (runtimeRefId: string): unknown => {
		const entry = runtimeRefs.get(runtimeRefId)
		runtimeRefs.delete(runtimeRefId)
		return entry?.value
	}

	const deleteRuntimeRef = (runtimeRefId: string): void => {
		runtimeRefs.delete(runtimeRefId)
	}

	const releaseTaskRuntimeRef = (taskId: string): void => {
		const runtimeRefId = taskRuntimeRef.get(taskId)
		if (!runtimeRefId) {
			return
		}
		taskRuntimeRef.delete(taskId)
		deleteRuntimeRef(runtimeRefId)
	}

	const dispatchTask = (
		fxName: `$fx_${string}`,
		payload: DispatchRuntimeTaskPayload = {},
		options: DispatchRuntimeTaskOptions = {},
	): RuntimeTaskDescriptor => {
		if (!fxName.startsWith('$fx_')) {
			throw new Error(`Runtime task name must start with $fx_, received ${fxName}`)
		}
		if (payload.data !== undefined && !isSerializable(payload.data)) {
			throw new Error(`Runtime task payload.data must be serializable for ${fxName}`)
		}

		const queuePolicy = options.queuePolicy ?? 'queue-all'
		const intentKey = options.intentKey ?? fxName
		const existingTaskId = queuedTaskByIntent.get(intentKey)
		let dropped = false
		let replacedTaskId: string | undefined

		taskSeq += 1
		const taskId = `task_${taskSeq}`
		const runtimeRefId = payload.runtimeRef === undefined ? undefined : putRuntimeRef(payload.runtimeRef)

		if (queuePolicy === 'keep-first' && existingTaskId) {
			dropped = true
			if (runtimeRefId) {
				deleteRuntimeRef(runtimeRefId)
			}
			return {
				taskId,
				fxName,
				payload: { data: payload.data },
				queuePolicy,
				intentKey,
				dropped,
			}
		}

		if (queuePolicy === 'replace-last' && existingTaskId) {
			replacedTaskId = existingTaskId
			releaseTaskRuntimeRef(existingTaskId)
		}

		if (queuePolicy !== 'queue-all') {
			queuedTaskByIntent.set(intentKey, taskId)
		}
		if (runtimeRefId) {
			taskRuntimeRef.set(taskId, runtimeRefId)
		}

		return {
			taskId,
			fxName,
			payload: {
				...(runtimeRefId ? { runtimeRefId } : {}),
				...(payload.data !== undefined ? { data: payload.data } : {}),
			},
			queuePolicy,
			intentKey,
			dropped,
			...(replacedTaskId ? { replacedTaskId } : {}),
		}
	}

	const completeTask = (task: Pick<RuntimeTaskDescriptor, 'taskId' | 'intentKey'>): void => {
		const queuedTaskId = queuedTaskByIntent.get(task.intentKey)
		if (queuedTaskId === task.taskId) {
			queuedTaskByIntent.delete(task.intentKey)
		}
		taskRuntimeRef.delete(task.taskId)
	}

	const clear = (): void => {
		runtimeRefs.clear()
		queuedTaskByIntent.clear()
		taskRuntimeRef.clear()
	}

	return {
		dispatchTask,
		consumeRuntimeRef,
		deleteRuntimeRef,
		completeTask,
		clear,
	}
}
