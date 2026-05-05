import type { EntityType } from './types'

export type EditorActionScopeType = EntityType | 'root' | 'session'

export interface EditorActionScope {
	nodeId: string
	type: EditorActionScopeType
}

export const ROOT_ACTION_SCOPE: EditorActionScope = Object.freeze({ nodeId: '$root', type: 'root' })
export const SESSION_ACTION_SCOPE: EditorActionScope = Object.freeze({ nodeId: '$session', type: 'session' })

export const createEntityActionScope = (nodeId: string, type: EntityType): EditorActionScope => ({
	nodeId,
	type,
})
