import type {
	CreatedIdRefToken,
	EditorActionBuildResult,
	EditorActionTransactionStep,
} from '../domain/actionTransactions'
import type { EditorActionEnvironment } from './editorActionEnvironment'

export interface ExecuteActionTransactionOptions {
	applySessionPatch?: (patch: Record<string, unknown>) => void
	runEffect?: (effect: string, payload?: unknown) => void | Promise<void>
}

interface TransactionExecutionContext {
	createdIdRefs: Map<string, string>
}

const isCreatedIdRefToken = (value: unknown): value is CreatedIdRefToken => {
	if (typeof value !== 'object' || value === null) {
		return false
	}

	const maybeToken = value as Record<string, unknown>
	return typeof maybeToken.$createdIdRef === 'string'
}

const resolveTransactionValue = (
	value: unknown,
	context: TransactionExecutionContext,
): unknown => {
	if (isCreatedIdRefToken(value)) {
		return context.createdIdRefs.get(value.$createdIdRef) ?? null
	}

	if (Array.isArray(value)) {
		return value.map((item) => resolveTransactionValue(item, context))
	}

	if (typeof value === 'object' && value !== null) {
		const resolved: Record<string, unknown> = {}
		for (const [key, nestedValue] of Object.entries(value)) {
			resolved[key] = resolveTransactionValue(nestedValue, context)
		}
		return resolved
	}

	return value
}

const executeStep = async (
	env: EditorActionEnvironment,
	step: EditorActionTransactionStep,
	options: ExecuteActionTransactionOptions,
	context: TransactionExecutionContext,
): Promise<void> => {
	switch (step.type) {
		case 'command': {
			const result = await env.authority.dispatch(step.command)
			if (step.holdCreatedIdAs) {
				const createdIdKey = step.createdIdKey ?? 'clipId'
				const value = result.createdIds?.[createdIdKey]
				if (value !== undefined && value !== null) {
					context.createdIdRefs.set(step.holdCreatedIdAs, String(value))
				}
			}
			return
		}
		case 'session':
			options.applySessionPatch?.(resolveTransactionValue(step.patch, context) as Record<string, unknown>)
			return
		case 'effect':
			await options.runEffect?.(step.effect, resolveTransactionValue(step.payload, context))
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
	const context: TransactionExecutionContext = {
		createdIdRefs: new Map<string, string>(),
	}

	if (result.type === 'none') {
		return
	}

	if (result.type === 'transaction') {
		for (const step of result.steps) {
			await executeStep(env, step, options, context)
		}
		return
	}

	await executeStep(env, result, options, context)
}
