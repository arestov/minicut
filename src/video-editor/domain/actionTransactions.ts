import type { Command } from './types'

export type EditorActionTransactionStep =
	| { type: 'command'; command: Command }
	| { type: 'session'; patch: Record<string, unknown> }
	| { type: 'effect'; effect: string; payload?: unknown }

export type EditorActionBuildResult =
	| EditorActionTransactionStep
	| { type: 'transaction'; steps: EditorActionTransactionStep[] }
	| { type: 'none' }

export const commandStep = (command: Command): EditorActionTransactionStep => ({
	type: 'command',
	command,
})
