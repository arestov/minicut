import { model } from 'dkt/model.js'
import { defaultClipTransform, reduceDktClipAction } from '../clipActions'
import { reduceDktTimelineClipAction } from '../timelineActions'

const defaultModelClipAttrs = {
	name: 'Clip',
	color: '#2563eb',
	start: 0,
	in: 0,
	opacity: { value: 1 },
	fadeIn: 0,
	fadeOut: 0,
	duration: 0,
	audio: { gain: 1, pan: 0 },
	transform: defaultClipTransform,
}

export const Clip = model({
	model_name: 'minicut_clip',
	attrs: {
		sourceClipId: ['input', null],
		name: ['input', 'Clip'],
		color: ['input', '#2563eb'],
		start: ['input', 0],
		in: ['input', 0],
		duration: ['input', 0],
		fadeIn: ['input', 0],
		fadeOut: ['input', 0],
		audio: ['input', { gain: 1, pan: 0 }],
		opacity: ['input', { value: 1 }],
		transform: ['input', defaultClipTransform],
	},
	actions: {
		syncAttrs: {
			to: {
				name: ['name'],
				color: ['color'],
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
				fadeIn: ['fadeIn'],
				fadeOut: ['fadeOut'],
				audio: ['audio'],
				opacity: ['opacity'],
				transform: ['transform'],
			},
			fn: [
				['name', 'color', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'] as const,
				(
					payload: unknown,
					name: unknown,
					color: unknown,
					start: unknown,
					inPoint: unknown,
					duration: unknown,
					fadeIn: unknown,
					fadeOut: unknown,
					audio: unknown,
					opacity: unknown,
					transform: unknown,
				) => {
					const patch = reduceDktClipAction('syncAttrs', payload, {
						name: typeof name === 'string' ? name : defaultModelClipAttrs.name,
						color: typeof color === 'string' ? color : defaultModelClipAttrs.color,
						start: typeof start === 'number' ? start : defaultModelClipAttrs.start,
						in: typeof inPoint === 'number' ? inPoint : defaultModelClipAttrs.in,
						duration: typeof duration === 'number' ? duration : defaultModelClipAttrs.duration,
						fadeIn: typeof fadeIn === 'number' ? fadeIn : defaultModelClipAttrs.fadeIn,
						fadeOut: typeof fadeOut === 'number' ? fadeOut : defaultModelClipAttrs.fadeOut,
						audio: audio as typeof defaultModelClipAttrs.audio,
						opacity: opacity as typeof defaultModelClipAttrs.opacity,
						transform: transform as typeof defaultClipTransform,
					})
					return patch ?? '$noop'
				},
			],
		},
		updateOpacity: {
			to: {
				opacity: ['opacity'],
			},
			fn: (payload: unknown) => {
				const patch = reduceDktClipAction('updateOpacity', payload, defaultModelClipAttrs)
				return patch ? { opacity: patch.opacity } : '$noop'
			},
		},
		rename: {
			to: {
				name: ['name'],
			},
			fn: (payload: unknown) => {
				const patch = reduceDktClipAction('rename', payload, defaultModelClipAttrs)
				return patch ? { name: patch.name } : '$noop'
			},
		},
		color: {
			to: {
				color: ['color'],
			},
			fn: (payload: unknown) => {
				const patch = reduceDktClipAction('color', payload, defaultModelClipAttrs)
				return patch ? { color: patch.color } : '$noop'
			},
		},
		setFade: {
			to: {
				fadeIn: ['fadeIn'],
				fadeOut: ['fadeOut'],
			},
			fn: [
				['fadeIn', 'fadeOut', 'duration'] as const,
				(payload: unknown, fadeIn: unknown, fadeOut: unknown, duration: unknown) => {
					const patch = reduceDktClipAction('setFade', payload, {
						...defaultModelClipAttrs,
						fadeIn: typeof fadeIn === 'number' ? fadeIn : 0,
						fadeOut: typeof fadeOut === 'number' ? fadeOut : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		setAudio: {
			to: {
				audio: ['audio'],
			},
			fn: [
				['audio'] as const,
				(payload: unknown, audio: unknown) => {
					const patch = reduceDktClipAction('setAudio', payload, {
						...defaultModelClipAttrs,
						audio: audio as { gain: number; pan: number },
					})
					return patch ?? '$noop'
				},
			],
		},
		setTransform: {
			to: {
				transform: ['transform'],
			},
			fn: [
				['transform'] as const,
				(payload: unknown, transform: unknown) => {
					const patch = reduceDktClipAction('setTransform', payload, {
						...defaultModelClipAttrs,
						transform: transform as typeof defaultClipTransform,
					})
					return patch ?? '$noop'
				},
			],
		},
		moveBy: {
			to: {
				start: ['start'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceDktTimelineClipAction('moveBy', payload, {
						start: typeof start === 'number' ? start : 0,
						in: typeof inPoint === 'number' ? inPoint : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		trim: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceDktTimelineClipAction('trim', payload, {
						start: typeof start === 'number' ? start : 0,
						in: typeof inPoint === 'number' ? inPoint : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		resize: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceDktTimelineClipAction('resize', payload, {
						start: typeof start === 'number' ? start : 0,
						in: typeof inPoint === 'number' ? inPoint : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		splitAt: {
			to: {
				duration: ['duration'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceDktTimelineClipAction('splitAt', payload, {
						start: typeof start === 'number' ? start : 0,
						in: typeof inPoint === 'number' ? inPoint : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
	},
})

export const CLIP_PROXY_CREATION_SHAPE = {
	attrs: ['sourceClipId', 'name', 'color', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'],
} as const
