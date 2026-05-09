/**
 * TESTING AND DEBUG ONLY — DO NOT USE IN PRODUCTION CODE
 *
 * Debug wrapper around createRuntimeTaskFacade that tracks dispatched tasks
 * and exposes a dump method for inspection.
 *
 * Usage:
 *
 *   const { facade, debugDumpTasks } = createDebugRuntimeTaskFacade()
 *   const task = facade.dispatchTask('$fx_renderExport', { data: { projectId: 'p1' } })
 *   console.log(debugDumpTasks())
 *   // { active: [...], completed: 3, dropped: 1 }
 *
 * Integrate with adapter/harness by replacing the bare facade
 * with this debug-wrapped version in test and REPL scenarios.
 */

import { createRuntimeTaskFacade, type RuntimeTaskDescriptor, type RuntimeTaskQueuePolicy } from '../../src/video-editor/app/runtimeTaskFacade'

export interface DebugTaskRecord {
	task: RuntimeTaskDescriptor
	dispatchedAt: number
	completedAt: number | null
}

export interface DebugTaskDump {
	active: DebugTaskRecord[]
	completed: number
	dropped: number
	byFxName: Record<string, number>
}

export const createDebugRuntimeTaskFacade = () => {
	const facade = createRuntimeTaskFacade()
	const history: DebugTaskRecord[] = []

	const wrappedDispatchTask = (
		fxName: `$fx_${string}`,
		payload: { runtimeRef?: unknown; data?: unknown } = {},
		options: { queuePolicy?: RuntimeTaskQueuePolicy; intentKey?: string } = {},
	): RuntimeTaskDescriptor => {
		const task = facade.dispatchTask(fxName, payload, options)
		history.push({
			task,
			dispatchedAt: Date.now(),
			completedAt: null,
		})
		return task
	}

	const wrappedCompleteTask = (task: Pick<RuntimeTaskDescriptor, 'taskId' | 'intentKey'>): void => {
		facade.completeTask(task)
		const record = history.find((r) => r.task.taskId === task.taskId)
		if (record) {
			record.completedAt = Date.now()
		}
	}

	const debugDumpTasks = (): DebugTaskDump => {
		const active: DebugTaskRecord[] = []
		let completed = 0
		let dropped = 0
		const byFxName: Record<string, number> = {}

		for (const record of history) {
			const fxName = record.task.fxName
			byFxName[fxName] = (byFxName[fxName] ?? 0) + 1

			if (record.task.dropped) {
				dropped += 1
			} else if (record.completedAt != null) {
				completed += 1
			} else {
				active.push(record)
			}
		}

		return { active, completed, dropped, byFxName }
	}

	return {
		facade: {
			dispatchTask: wrappedDispatchTask,
			consumeRuntimeRef: facade.consumeRuntimeRef,
			deleteRuntimeRef: facade.deleteRuntimeRef,
			completeTask: wrappedCompleteTask,
			clear: facade.clear,
		},
		debugDumpTasks,
	}
}
