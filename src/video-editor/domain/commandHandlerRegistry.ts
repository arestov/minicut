import type { Command, DispatchResult, ProjectRegistry } from './types'
import { CMD } from './types'
import type { DispatchContext } from './applyCommandHelpers'
import { handleClipUpdateAttrs } from './clipCommandHandlers'
import { handleEffectAdd, handleEffectRemove, handleEffectReorder, handleEffectUpdateAttrs } from './effectCommandHandlers'
import { handleProjectCreate, handleResourceImport, handleTrackCreate } from './projectCommandHandlers'
import { handleTextUpdateAttrs } from './textCommandHandlers'
import { handleTextAdd, handleTimelineAddClip, handleTimelineDeleteClip, handleTimelineMoveClip, handleTimelineSplitClip } from './timelineCommandHandlers'

export type AnyCommandHandler = (
	registry: ProjectRegistry,
	command: Command,
	context?: DispatchContext,
) => DispatchResult

export const commandHandlers: Partial<Record<Command['c'], AnyCommandHandler>> = {
	[CMD.PROJECT_CREATE]: handleProjectCreate as AnyCommandHandler,
	[CMD.RESOURCE_IMPORT]: handleResourceImport as AnyCommandHandler,
	[CMD.TRACK_CREATE]: handleTrackCreate as AnyCommandHandler,
	[CMD.TIMELINE_ADD_CLIP]: handleTimelineAddClip as AnyCommandHandler,
	[CMD.TIMELINE_MOVE_CLIP]: handleTimelineMoveClip as AnyCommandHandler,
	[CMD.TIMELINE_SPLIT_CLIP]: handleTimelineSplitClip as AnyCommandHandler,
	[CMD.TIMELINE_DELETE_CLIP]: handleTimelineDeleteClip as AnyCommandHandler,
	[CMD.CLIP_UPDATE_ATTRS]: handleClipUpdateAttrs as AnyCommandHandler,
	[CMD.EFFECT_ADD]: handleEffectAdd as AnyCommandHandler,
	[CMD.EFFECT_REMOVE]: handleEffectRemove as AnyCommandHandler,
	[CMD.EFFECT_UPDATE_ATTRS]: handleEffectUpdateAttrs as AnyCommandHandler,
	[CMD.EFFECT_REORDER]: handleEffectReorder as AnyCommandHandler,
	[CMD.TEXT_ADD]: handleTextAdd as AnyCommandHandler,
	[CMD.TEXT_UPDATE_ATTRS]: handleTextUpdateAttrs as AnyCommandHandler,
}
