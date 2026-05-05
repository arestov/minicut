import type { EditorActionBuildResult, EditorActionTransactionStep } from '../domain/actionTransactions'
import type { EditorActionEnvironment } from './editorActionEnvironment'

export interface ExecuteActionTransactionOptions {
	applySessionPatch?: (patch: Record<string, unknown>) => void
	runEffect?: (effect: string, payload?: unknown) => void | Promise<void>
}

const executeStep = async (
	env: EditorActionEnvironment,
	step: EditorActionTransactionStep,
	options: ExecuteActionTransactionOptions,
): Promise<void> => {
	switch (step.type) {
		case 'command':
			await env.authority.dispatch(step.command)
			return
		case 'session':
			options.applySessionPatch?.(step.patch)
			return
		case 'effect':
			await options.runEffect?.(step.effect, step.payload)
			return
		default:
			throw new Error(`Unsupported transaction step ${(step as { type: string }).type}`)
	}
}

export const executeActionBuildResult = async (
	env: EditorActionEnvironment,
	result: EditorActionBuildResult,
	options: ExecuteActionTransactionOptions = {},
): Promise<void> => {
	if (result.type === 'none') {
		return
	}

	if (result.type === 'transaction') {
		for (const step of result.steps) {
			await executeStep(env, step, options)
		}
		return
	}

	await executeStep(env, result, options)
}
