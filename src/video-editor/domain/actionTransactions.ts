import type { Command } from './types'

export interface CreatedIdRefToken {
	$createdIdRef: string
}

export const createdIdRef = (refId: string): CreatedIdRefToken => ({
	$createdIdRef: refId,
})

export type CreatedIdKey = 'projectId' | 'resourceId' | 'clipId' | 'audioClipId' | 'effectId' | 'textId'

export type EditorActionTransactionStep =
	| {
			type: 'command'
			command: Command
			holdCreatedIdAs?: string
			createdIdKey?: CreatedIdKey
	  }
	| { type: 'session'; patch: Record<string, unknown> }
	| { type: 'effect'; effect: string; payload?: unknown }

export type EditorActionBuildResult =
	| EditorActionTransactionStep
	| { type: 'transaction'; steps: EditorActionTransactionStep[] }
	| { type: 'none' }

export const commandStep = (
	command: Command,
	options?: {
		holdCreatedIdAs?: string
		createdIdKey?: CreatedIdKey
	},
): EditorActionTransactionStep => ({
	type: 'command',
	command,
	...(options?.holdCreatedIdAs ? { holdCreatedIdAs: options.holdCreatedIdAs } : {}),
	...(options?.createdIdKey ? { createdIdKey: options.createdIdKey } : {}),
})
