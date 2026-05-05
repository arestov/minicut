import { describe, expect, it, vi } from 'vitest'
import { commandStep, type EditorActionBuildResult } from '../domain/actionTransactions'
import { CMD } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import { executeActionBuildResult } from './actionTransactionExecutor'

const createEnv = () => {
	const dispatch = vi.fn(async () => ({ envelope: { projectId: 'project:1', version: 1, patches: [] } }))
	return {
		env: { authority: { dispatch } } as unknown as EditorActionEnvironment,
		dispatch,
	}
}

describe('executeActionBuildResult', () => {
	it('dispatches single command steps', async () => {
		const { env, dispatch } = createEnv()
		const command = { c: CMD.TRACK_CREATE, p: { projectId: 'project:1', kind: 'video' as const } }

		await executeActionBuildResult(env, commandStep(command))

		expect(dispatch).toHaveBeenCalledWith(command)
	})

	it('executes transaction steps in order', async () => {
		const { env, dispatch } = createEnv()
		const applySessionPatch = vi.fn()
		const runEffect = vi.fn()
		const result: EditorActionBuildResult = {
			type: 'transaction',
			steps: [
				commandStep({ c: CMD.TRACK_CREATE, p: { projectId: 'project:1', kind: 'video' } }),
				{ type: 'session', patch: { cursor: 1 } },
				{ type: 'effect', effect: 'render', payload: { id: 'job:1' } },
			],
		}

		await executeActionBuildResult(env, result, { applySessionPatch, runEffect })

		expect(dispatch).toHaveBeenCalledTimes(1)
		expect(applySessionPatch).toHaveBeenCalledWith({ cursor: 1 })
		expect(runEffect).toHaveBeenCalledWith('render', { id: 'job:1' })
	})
})
