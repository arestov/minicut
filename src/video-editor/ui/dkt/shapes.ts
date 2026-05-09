import { defineShape } from '../../../dkt-react-sync/shape/defineShape'

const effectShape = defineShape({
	attrs: ['sourceEffectId', 'name', 'kind', 'enabled', 'amount', 'params', 'color'],
})

const textShape = defineShape({
	attrs: ['sourceTextId', 'content', 'style', 'box'],
})

const resourceShape = defineShape({
	attrs: ['sourceResourceId', 'name', 'kind', 'url', 'mime', 'duration', 'width', 'height', 'size', 'source', 'status', 'data'],
})

const clipShape = defineShape({
	attrs: ['sourceClipId', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform', 'mediaKind'],
	one: {
		resource: resourceShape,
		text: textShape,
	},
	many: {
		effects: effectShape,
	},
})

const trackShape = defineShape({
	attrs: ['sourceTrackId', 'kind', 'name', 'muted', 'locked', 'height'],
	many: {
		clips: clipShape,
		text: textShape,
	},
})

const projectShape = defineShape({
	attrs: ['sourceProjectId', 'title', 'fps', 'width', 'height', 'duration', 'createdAt', 'updatedAt', 'isLandscape'],
	many: {
		tracks: trackShape,
		resources: resourceShape,
	},
})

export const miniCutEditorRootShape = defineShape({
	attrs: ['activeProjectId', 'selectedEntityId', 'activeInspectorTab', 'cursor', 'isPlaying', 'timelineZoom', 'timelineTool', 'snappingEnabled', 'exportProgress', 'exportRequest'],
	one: {
		activeProject: projectShape,
		selectedClip: clipShape,
		pioneer: defineShape({
			many: {
				project: projectShape,
				effect: effectShape,
			},
		}),
	},
})
