import { nanoid } from 'nanoid'
import { observable, type Observable } from '@legendapp/state'
import type { EditorSessionState } from '../domain/types'

export const TIMELINE_ZOOM_MIN = 8
export const TIMELINE_ZOOM_MAX = 96
export const TIMELINE_ZOOM_STEP = 8
export const TIMELINE_ZOOM_DEFAULT = 56

export const createInitialSession = (): EditorSessionState => ({
	tabId: `tab-${nanoid(6)}`,
	activeProjectId: null,
	selectedEntityId: null,
	cursor: 0,
	isPlaying: false,
	timelineZoom: TIMELINE_ZOOM_DEFAULT,
})

export const createSessionStore = (): Observable<EditorSessionState> =>
	observable<EditorSessionState>(createInitialSession())
