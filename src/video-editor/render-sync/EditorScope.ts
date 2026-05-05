import type { EntityType } from '../domain/types'

export type EditorScopeType = EntityType | 'root' | 'session'

export interface EditorScope {
	nodeId: string
	type: EditorScopeType
}

export const ROOT_SCOPE: EditorScope = Object.freeze({ nodeId: '$root', type: 'root' })
export const SESSION_SCOPE: EditorScope = Object.freeze({ nodeId: '$session', type: 'session' })

export const createEntityScope = (nodeId: string, type: EntityType): EditorScope => ({
	nodeId,
	type,
})
