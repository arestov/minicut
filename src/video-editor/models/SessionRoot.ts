import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { TIMELINE_ZOOM_DEFAULT } from './sessionZoom'
import { createPreviewFrame, lookupPreviewBufferFrame, type PreviewBuffer, type PreviewFrame, type PreviewStructure } from '../read-model/previewComps'
import { dktSessionActions } from './SessionRoot/actions'

const DEFAULT_PREVIEW_STRUCTURE: PreviewStructure = { clipSources: [] }

export const EditorSessionRoot = model({
	extends: BaseSessionRoot,
	model_name: 'minicut_session_root',
	attrs: {
		sessionKey: ['input', null],
		route: ['input', null],
		closedAt: ['input', null],
		isCommonRoot: ['input', false],
		tabId: ['input', null],
		activeProjectId: ['input', null],
		selectedEntityId: ['input', null],
		activeInspectorTab: ['input', 'edit'],
		cursor: ['input', 0],
		isPlaying: ['input', false],
		previewBuffer: ['input', null as PreviewBuffer | null],
		timelineZoom: ['input', TIMELINE_ZOOM_DEFAULT],
		timelineTool: ['input', 'select'],
		snappingEnabled: ['input', true],
		previewStructure: ['comp', ['< @one:previewClipSources < activeProject'] as const,
			(previewClipSources: unknown): PreviewStructure => {
				if (previewClipSources && typeof previewClipSources === 'object' && Array.isArray((previewClipSources as PreviewStructure).clipSources)) {
					return previewClipSources as PreviewStructure
				}
				return DEFAULT_PREVIEW_STRUCTURE
			}],
		previewFrame: ['comp', ['previewStructure', 'cursor', 'previewBuffer', 'isPlaying'] as const,
			(previewStructure: unknown, cursor: unknown, previewBuffer: unknown, isPlaying: unknown): PreviewFrame => {
				const time = typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : 0
				if (isPlaying) {
					const buffered = lookupPreviewBufferFrame(previewBuffer as PreviewBuffer | null, time)
					if (buffered) return buffered
				}
				return createPreviewFrame(
					previewStructure && typeof previewStructure === 'object' && Array.isArray((previewStructure as { clipSources?: unknown }).clipSources)
						? previewStructure as PreviewStructure
						: DEFAULT_PREVIEW_STRUCTURE,
					time,
				)
			}],
		selectedClipSummary: ['comp', [
			'< @one:sourceClipId < selectedClip',
			'< @one:color < selectedClip',
			'< @one:name < selectedClip',
			'< @one:name < selectedClip.track',
		] as const, (sourceClipId: unknown, color: unknown, clipName: unknown, trackName: unknown) => {
			if (typeof sourceClipId !== 'string' || !sourceClipId) return null
			return {
				color: typeof color === 'string' && color ? color : '#2563eb',
				resourceName: typeof clipName === 'string' && clipName ? clipName : 'Clip',
				trackName: typeof trackName === 'string' && trackName ? trackName : 'Track',
			}
		}],
		selectedClipTrackPosition: ['comp', [
			'<< @all:activeProject.tracks',
			'<< @one:selectedClip.track',
			'< @one:name < selectedClip.track',
		] as const, (tracks: unknown, selectedTrack: unknown, trackName: unknown) => {
			if (!selectedTrack) return null
			const trackList = Array.isArray(tracks) ? tracks : []
			const index = trackList.indexOf(selectedTrack)
			if (index === -1) return null
			return {
				trackName: typeof trackName === 'string' && trackName
					? trackName
					: `Track ${index + 1}`,
				ordinal: index + 1,
			}
		}],
	},
	rels: {
		activeProject: ['input', { linking: '<< project << #' }],
		selectedTrack: ['input', { linking: '<< track << #' }],
		selectedClip: ['comp', [
			'<< @all:activeProject.tracks.clips',
			'< @all:sourceClipId < activeProject.tracks.clips',
			'selectedEntityId',
		] as const, (clips: unknown, sourceClipIds: unknown, selectedEntityId: unknown) => {
			if (typeof selectedEntityId !== 'string' || !selectedEntityId) return null
			const modelList = Array.isArray(clips) ? clips : []
			const idList = Array.isArray(sourceClipIds) ? sourceClipIds : []
			const index = idList.indexOf(selectedEntityId)
			if (index === -1 || !modelList[index]) return null
			return modelList[index]
		}, { linking: '<< clip << #' }],
		selectedResource: ['input', { linking: '<< resource << #' }],
		selectedText: ['input', { linking: '<< text << #' }],
		selectedEffect: ['input', { linking: '<< effect << #' }],
	},
	actions: dktSessionActions,
})
