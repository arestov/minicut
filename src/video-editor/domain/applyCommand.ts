import { commandHandlers } from './commandHandlerRegistry'
import { createDefaultColorCorrectionAttrs, createDefaultTextAttrs } from './applyCommandDefaults'
import type { DispatchContext } from './applyCommandHelpers'
import { validateCommand } from './validateCommand'
import type { Command, DispatchResult, ProjectRegistry } from './types'

export { createDefaultColorCorrectionAttrs, createDefaultTextAttrs }
export type { DispatchContext }

export const buildDispatchResult = (
	registry: ProjectRegistry,
	command: Command,
	context?: DispatchContext,
): DispatchResult => {
	validateCommand(registry, command)

	const handler = commandHandlers[command.c]
	if (!handler) {
		throw new Error(`Unsupported command code ${(command as { c: number }).c}`)
	}

	return handler(registry, command, context)
}
