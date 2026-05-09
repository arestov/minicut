import { describe, expect, it } from 'vitest'
import { createRuntimeTaskFacade } from './runtimeTaskFacade'

describe('createRuntimeTaskFacade', () => {
	it('stores runtimeRef as runtimeRefId and consumes it once', () => {
		const tasks = createRuntimeTaskFacade()
		const file = new File(['a'], 'a.txt', { type: 'text/plain' })

		const task = tasks.dispatchTask('$fx_handleInputFiles', {
			runtimeRef: [file],
			data: { source: 'input' },
		})

		expect(task.payload.runtimeRefId).toBeDefined()
		expect(task.payload.data).toEqual({ source: 'input' })

		const firstConsume = tasks.consumeRuntimeRef(String(task.payload.runtimeRefId))
		expect(firstConsume).toEqual([file])

		const secondConsume = tasks.consumeRuntimeRef(String(task.payload.runtimeRefId))
		expect(secondConsume).toBeUndefined()
	})

	it('drops keep-first duplicate task and releases new runtimeRef', () => {
		const tasks = createRuntimeTaskFacade()
		const first = tasks.dispatchTask('$fx_handleInputFiles', {
			runtimeRef: [new File(['a'], 'a.txt', { type: 'text/plain' })],
		}, {
			queuePolicy: 'keep-first',
			intentKey: 'import',
		})
		const second = tasks.dispatchTask('$fx_handleInputFiles', {
			runtimeRef: [new File(['b'], 'b.txt', { type: 'text/plain' })],
		}, {
			queuePolicy: 'keep-first',
			intentKey: 'import',
		})

		expect(second.dropped).toBe(true)
		expect(second.payload.runtimeRefId).toBeUndefined()
		expect(tasks.consumeRuntimeRef(String(first.payload.runtimeRefId))).toBeTruthy()
	})

	it('releases replaced runtimeRef for replace-last queue policy', () => {
		const tasks = createRuntimeTaskFacade()
		const first = tasks.dispatchTask('$fx_handleInputFiles', {
			runtimeRef: [new File(['a'], 'a.txt', { type: 'text/plain' })],
		}, {
			queuePolicy: 'replace-last',
			intentKey: 'import',
		})
		const second = tasks.dispatchTask('$fx_handleInputFiles', {
			runtimeRef: [new File(['b'], 'b.txt', { type: 'text/plain' })],
		}, {
			queuePolicy: 'replace-last',
			intentKey: 'import',
		})

		expect(second.replacedTaskId).toBe(first.taskId)
		expect(tasks.consumeRuntimeRef(String(first.payload.runtimeRefId))).toBeUndefined()
		expect(tasks.consumeRuntimeRef(String(second.payload.runtimeRefId))).toBeTruthy()
	})

	it('provides debug queue dump with active, completed, failed and dropped counters', () => {
		const tasks = createRuntimeTaskFacade()

		const active = tasks.dispatchTask('$fx_handleInputFiles', { data: { id: 'active' } })
		const completed = tasks.dispatchTask('$fx_renderExport', { data: { id: 'completed' } })
		const failed = tasks.dispatchTask('$fx_renderExport', { data: { id: 'failed' } }, { intentKey: 'export:failed' })
		const kept = tasks.dispatchTask('$fx_renderExport', { data: { id: 'keep-1' } }, {
			queuePolicy: 'keep-first',
			intentKey: 'export:keep-first',
		})
		const dropped = tasks.dispatchTask('$fx_renderExport', { data: { id: 'keep-2' } }, {
			queuePolicy: 'keep-first',
			intentKey: 'export:keep-first',
		})

		tasks.completeTask(completed)
		tasks.failTask(failed)

		const dump = tasks.debugDumpTasksTesting()

		expect(dump.completed).toBe(1)
		expect(dump.failed).toBe(1)
		expect(dump.dropped).toBe(1)
		expect(dump.active.map((task) => task.taskId).sort()).toEqual([active.taskId, kept.taskId].sort())
		expect(dump.active.find((task) => task.taskId === dropped.taskId)).toBeUndefined()
		expect(dump.byFxName.$fx_handleInputFiles).toBe(1)
		expect(dump.byFxName.$fx_renderExport).toBe(4)
	})
})
