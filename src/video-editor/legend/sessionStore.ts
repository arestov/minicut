import { nanoid } from 'nanoid'
import { observable, type Observable } from '@legendapp/state'
import type { EditorSessionState } from '../domain/types'

export const createInitialSession = (): EditorSessionState => ({
	tabId: `tab-${nanoid(6)}`,
	activeProjectId: null,
	selectedEntityId: null,
	cursor: 0,
	isPlaying: false,
})

export const createSessionStore = (): Observable<EditorSessionState> =>
	observable<EditorSessionState>(createInitialSession())
