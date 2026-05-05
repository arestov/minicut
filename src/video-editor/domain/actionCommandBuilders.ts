import type { EditorActionRequest } from './actionRequests'
import type { EditorActionScope } from './actionScope'
import type { ClipAttrs, Command, EffectAttrs, ProjectRegistry, TextAttrs } from './types'
import { CMD } from './types'
import { commandStep, type EditorActionBuildResult } from './actionTransactions'

const roundToTenths = (value: number): number => Math.round(value * 10) / 10

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs

const getClip = (registry: ProjectRegistry, scope: EditorActionScope) => {
	const clip = registry.entitiesById[scope.nodeId]
	return clip?.type === 'clip' ? clip : null
}

const getResizedClipAttrs = (attrs: ClipAttrs, edge: 'start' | 'end', delta: number): Pick<ClipAttrs, 'start' | 'in' | 'duration'> | Pick<ClipAttrs, 'duration'> => {
	if (edge === 'end') {
		return {
			duration: clamp(roundToTenths(attrs.duration + delta), 0.5, 120),
		}
	}

	const clipEnd = attrs.start + attrs.duration
	const minStart = Math.max(0, attrs.start - attrs.in)
	const nextStart = clamp(roundToTenths(attrs.start + delta), minStart, clipEnd - 0.5)
	return {
		start: nextStart,
		in: roundToTenths(attrs.in + (nextStart - attrs.start)),
		duration: roundToTenths(clipEnd - nextStart),
	}
}

export interface EditorActionCommandBuilderContext {
	registry: ProjectRegistry
	activeProjectId: string | null
}

export const buildEditorActionCommand = (
	request: EditorActionRequest,
	context: EditorActionCommandBuilderContext,
): EditorActionBuildResult => {
	const { scope, name, payload } = request

	if (name === 'addTrack') {
		const kind = (payload as { kind?: unknown } | undefined)?.kind
		if (!context.activeProjectId || (kind !== 'video' && kind !== 'audio')) {
			return { type: 'none' }
		}

		return commandStep({ c: CMD.TRACK_CREATE, p: { projectId: context.activeProjectId, kind } })
	}

	if (scope.type === 'text' && name === 'updateText') {
		return commandStep({ c: CMD.TEXT_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: payload as Partial<TextAttrs> } })
	}

	if (scope.type === 'effect' && name === 'updateEffect') {
		return commandStep({ c: CMD.EFFECT_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: payload as Partial<EffectAttrs> } })
	}

	if (scope.type !== 'clip') {
		return { type: 'none' }
	}

	const clip = getClip(context.registry, scope)
	if (!clip) {
		return { type: 'none' }
	}

	const clipAttrs = asClipAttrs(clip.attrs)

	switch (name) {
		case 'rename': {
			const nameValue = (payload as { name?: unknown } | undefined)?.name
			return typeof nameValue === 'string'
				? commandStep({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: { name: nameValue } } })
				: { type: 'none' }
		}
		case 'color': {
			const color = (payload as { color?: unknown } | undefined)?.color
			return typeof color === 'string'
				? commandStep({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: { color } } })
				: { type: 'none' }
		}
		case 'setOpacity': {
			const opacityPercent = (payload as { opacityPercent?: unknown } | undefined)?.opacityPercent
			return typeof opacityPercent === 'number'
				? commandStep({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: { opacity: { value: roundToTenths(opacityPercent / 100) } } } })
				: { type: 'none' }
		}
		case 'setFade': {
			const edge = (payload as { edge?: unknown } | undefined)?.edge
			const delta = (payload as { delta?: unknown } | undefined)?.delta
			if ((edge !== 'in' && edge !== 'out') || typeof delta !== 'number') {
				return { type: 'none' }
			}

			const key = edge === 'in' ? 'fadeIn' : 'fadeOut'
			const current = Number(clipAttrs[key] ?? 0)
			const nextFade = clamp(roundToTenths(current + delta), 0, clipAttrs.duration)
			return commandStep({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: { [key]: nextFade } } })
		}
		case 'setTransform': {
			const partial = payload as Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>
			return commandStep({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: scope.nodeId,
					attrs: {
						transform: {
							x: { value: partial.x ?? clipAttrs.transform.x.value },
							y: { value: partial.y ?? clipAttrs.transform.y.value },
							scale: { value: partial.scale ?? clipAttrs.transform.scale.value },
							rotation: { value: partial.rotation ?? clipAttrs.transform.rotation.value },
						},
					},
				},
			})
		}
		case 'setAudio': {
			const partial = payload as Partial<Record<'gain' | 'pan', number>>
			return commandStep({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: scope.nodeId,
					attrs: {
						audio: {
							gain: partial.gain ?? clipAttrs.audio?.gain ?? 1,
							pan: partial.pan ?? clipAttrs.audio?.pan ?? 0,
						},
					},
				},
			})
		}
		case 'trim':
		case 'resize': {
			const edge = (payload as { edge?: unknown } | undefined)?.edge
			const delta = (payload as { delta?: unknown } | undefined)?.delta
			if ((edge !== 'start' && edge !== 'end') || typeof delta !== 'number' || delta === 0) {
				return { type: 'none' }
			}

			return commandStep({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: getResizedClipAttrs(clipAttrs, edge, delta) } })
		}
		case 'moveBy': {
			const delta = (payload as { delta?: unknown } | undefined)?.delta
			return typeof delta === 'number' && delta !== 0
				? commandStep({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: scope.nodeId, delta } })
				: { type: 'none' }
		}
		case 'splitAt': {
			const time = (payload as { time?: unknown } | undefined)?.time
			return typeof time === 'number'
				? commandStep({ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: scope.nodeId, time } })
				: { type: 'none' }
		}
		case 'addEffect': {
			const kind = (payload as { kind?: unknown } | undefined)?.kind
			return kind === 'blur' || kind === 'sharpen' || kind === 'tint'
				? commandStep({ c: CMD.EFFECT_ADD, p: { id: scope.nodeId, name: `${kind[0].toUpperCase()}${kind.slice(1)}`, kind, amount: kind === 'tint' ? 0.35 : 0.25 } })
				: { type: 'none' }
		}
		case 'addColorCorrection':
			return commandStep({ c: CMD.EFFECT_ADD, p: { id: scope.nodeId, name: 'Primary Correction', kind: 'color-correction' } })
		case 'removeEffect': {
			const effectId = (payload as { effectId?: unknown } | undefined)?.effectId
			return typeof effectId === 'string'
				? commandStep({ c: CMD.EFFECT_REMOVE, p: { id: scope.nodeId, effectId } })
				: { type: 'none' }
		}
		default:
			return { type: 'none' }
	}
}

export const expectCommand = (result: EditorActionBuildResult): Command | null =>
	result.type === 'command' ? result.command : null
