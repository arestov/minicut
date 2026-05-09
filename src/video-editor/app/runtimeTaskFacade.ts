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
		runtimeHandleId?: string
		data?: unknown
	}
	queuePolicy: RuntimeTaskQueuePolicy
	intentKey: string
	dropped: boolean
	replacedTaskId?: string
}

export interface RuntimeTaskDebugDumpTesting {
	active: RuntimeTaskDescriptor[]
	completed: number
	failed: number
	dropped: number
	byFxName: Record<string, number>
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
	const taskHistory = new Map<string, RuntimeTaskDescriptor>()
	const taskStatus = new Map<string, 'active' | 'completed' | 'failed' | 'dropped'>()

	const putRuntimeRef = (value: unknown): string => {
		runtimeRefSeq += 1
		const runtimeHandleId = `rt_tmp_${runtimeRefSeq}`
		runtimeRefs.set(runtimeHandleId, { value })
		return runtimeHandleId
	}

	const consumeRuntimeRef = (runtimeHandleId: string): unknown => {
		const entry = runtimeRefs.get(runtimeHandleId)
		runtimeRefs.delete(runtimeHandleId)
		return entry?.value
	}

	const deleteRuntimeRef = (runtimeHandleId: string): void => {
		runtimeRefs.delete(runtimeHandleId)
	}

	const releaseTaskRuntimeRef = (taskId: string): void => {
		const runtimeHandleId = taskRuntimeRef.get(taskId)
		if (!runtimeHandleId) {
			return
		}
		taskRuntimeRef.delete(taskId)
		deleteRuntimeRef(runtimeHandleId)
	}

	const markDropped = (taskId: string): void => {
		if (!taskHistory.has(taskId)) {
			return
		}
		taskStatus.set(taskId, 'dropped')
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
		const runtimeHandleId = payload.runtimeRef === undefined ? undefined : putRuntimeRef(payload.runtimeRef)

		if (queuePolicy === 'keep-first' && existingTaskId) {
			dropped = true
			if (runtimeHandleId) {
				deleteRuntimeRef(runtimeHandleId)
			}
			const descriptor: RuntimeTaskDescriptor = {
				taskId,
				fxName,
				payload: { data: payload.data },
				queuePolicy,
				intentKey,
				dropped,
			}
			taskHistory.set(taskId, descriptor)
			taskStatus.set(taskId, 'dropped')
			return descriptor
		}

		if (queuePolicy === 'replace-last' && existingTaskId) {
			replacedTaskId = existingTaskId
			releaseTaskRuntimeRef(existingTaskId)
			markDropped(existingTaskId)
		}

		if (queuePolicy !== 'queue-all') {
			queuedTaskByIntent.set(intentKey, taskId)
		}
		if (runtimeHandleId) {
			taskRuntimeRef.set(taskId, runtimeHandleId)
		}

		const descriptor: RuntimeTaskDescriptor = {
			taskId,
			fxName,
			payload: {
				...(runtimeHandleId ? { runtimeHandleId } : {}),
				...(payload.data !== undefined ? { data: payload.data } : {}),
			},
			queuePolicy,
			intentKey,
			dropped,
			...(replacedTaskId ? { replacedTaskId } : {}),
		}

		taskHistory.set(taskId, descriptor)
		taskStatus.set(taskId, dropped ? 'dropped' : 'active')
		return descriptor
	}

	const completeTask = (task: Pick<RuntimeTaskDescriptor, 'taskId' | 'intentKey'>): void => {
		const queuedTaskId = queuedTaskByIntent.get(task.intentKey)
		if (queuedTaskId === task.taskId) {
			queuedTaskByIntent.delete(task.intentKey)
		}
		taskRuntimeRef.delete(task.taskId)
		if (taskHistory.has(task.taskId) && taskStatus.get(task.taskId) === 'active') {
			taskStatus.set(task.taskId, 'completed')
		}
	}

	const failTask = (task: Pick<RuntimeTaskDescriptor, 'taskId' | 'intentKey'>): void => {
		const queuedTaskId = queuedTaskByIntent.get(task.intentKey)
		if (queuedTaskId === task.taskId) {
			queuedTaskByIntent.delete(task.intentKey)
		}
		taskRuntimeRef.delete(task.taskId)
		if (taskHistory.has(task.taskId) && taskStatus.get(task.taskId) === 'active') {
			taskStatus.set(task.taskId, 'failed')
		}
	}

	const debugDumpTasksTesting = (): RuntimeTaskDebugDumpTesting => {
		const active: RuntimeTaskDescriptor[] = []
		let completed = 0
		let failed = 0
		let dropped = 0
		const byFxName: Record<string, number> = {}

		for (const [taskId, descriptor] of taskHistory.entries()) {
			const status = taskStatus.get(taskId) ?? 'active'
			byFxName[descriptor.fxName] = (byFxName[descriptor.fxName] ?? 0) + 1

			if (status === 'active') {
				active.push(descriptor)
				continue
			}
			if (status === 'completed') {
				completed += 1
				continue
			}
			if (status === 'failed') {
				failed += 1
				continue
			}
			dropped += 1
		}

		return {
			active,
			completed,
			failed,
			dropped,
			byFxName,
		}
	}

	const clear = (): void => {
		runtimeRefs.clear()
		queuedTaskByIntent.clear()
		taskRuntimeRef.clear()
		taskHistory.clear()
		taskStatus.clear()
	}

	return {
		dispatchTask,
		putRuntimeRef,
		consumeRuntimeRef,
		deleteRuntimeRef,
		completeTask,
		failTask,
		// TESTING AND DEBUG ONLY — inspect runtime task queue state in REPL/tests.
		debugDumpTasksTesting,
		clear,
	}
}
