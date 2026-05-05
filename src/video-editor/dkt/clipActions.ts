import { getProjectForEntity } from '../domain/selectors'
import { PATCH, type AnimatedScalar, type ClipAttrs, type PatchEnvelope, type ProjectRegistry, type TransformAttrs } from '../domain/types'

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export type DktClipActionName = 'updateOpacity' | 'rename' | 'color' | 'setFade' | 'setAudio' | 'setTransform'

export type DktClipActionPatch = Partial<Pick<ClipAttrs,
	| 'name'
	| 'color'
	| 'opacity'
	| 'fadeIn'
	| 'fadeOut'
	| 'audio'
	| 'transform'
>>

export const clipUpdateOpacityAction = {
	to: ['opacity'] as const,
	fn(opacityPercent: number): { value: number } | null {
		if (!Number.isFinite(opacityPercent)) {
			return null
		}

		return { value: roundToTenths(opacityPercent / 100) }
	},
}

export const clipRenameAction = {
	to: ['name'] as const,
	fn(payload: unknown): string | null {
		const value = (payload as { name?: unknown } | null)?.name ?? payload
		return typeof value === 'string' ? value : null
	},
}

export const clipColorAction = {
	to: ['color'] as const,
	fn(payload: unknown): string | null {
		const value = (payload as { color?: unknown } | null)?.color ?? payload
		return typeof value === 'string' ? value : null
	},
}

export const clipSetFadeAction = {
	fn(payload: unknown, clipAttrs: Pick<ClipAttrs, 'fadeIn' | 'fadeOut' | 'duration'>): Pick<ClipAttrs, 'fadeIn'> | Pick<ClipAttrs, 'fadeOut'> | null {
		const edge = (payload as { edge?: unknown } | null)?.edge
		const delta = (payload as { delta?: unknown } | null)?.delta
		if ((edge !== 'in' && edge !== 'out') || typeof delta !== 'number') {
			return null
		}

		const key = edge === 'in' ? 'fadeIn' : 'fadeOut'
		const current = Number(clipAttrs[key] ?? 0)
		return { [key]: clamp(roundToTenths(current + delta), 0, clipAttrs.duration) }
	},
}

export const clipSetAudioAction = {
	fn(payload: unknown, audio: ClipAttrs['audio']): Pick<ClipAttrs, 'audio'> {
		const partial = payload as Partial<Record<'gain' | 'pan', number>>
		return {
			audio: {
				gain: partial.gain ?? audio?.gain ?? 1,
				pan: partial.pan ?? audio?.pan ?? 0,
			},
		}
	},
}

export const clipSetTransformAction = {
	fn(payload: unknown, transform: TransformAttrs): Pick<ClipAttrs, 'transform'> {
		const partial = payload as Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>
		return {
			transform: {
				x: { value: partial.x ?? transform.x.value },
				y: { value: partial.y ?? transform.y.value },
				scale: { value: partial.scale ?? transform.scale.value },
				rotation: { value: partial.rotation ?? transform.rotation.value },
			},
		}
	},
}

export const defaultClipTransform: TransformAttrs = {
	x: { value: 0 },
	y: { value: 0 },
	scale: { value: 1 },
	rotation: { value: 0 },
}

export const reduceDktClipAction = (
	actionName: DktClipActionName,
	payload: unknown,
	clipAttrs: Pick<ClipAttrs, 'name' | 'color' | 'opacity' | 'fadeIn' | 'fadeOut' | 'duration' | 'audio' | 'transform'>,
): DktClipActionPatch | null => {
	switch (actionName) {
		case 'updateOpacity': {
			const opacityPercent = typeof payload === 'number'
				? payload
				: (payload as { opacityPercent?: unknown } | null)?.opacityPercent
			const opacity = typeof opacityPercent === 'number' ? clipUpdateOpacityAction.fn(opacityPercent) : null
			return opacity ? { opacity } : null
		}
		case 'rename': {
			const name = clipRenameAction.fn(payload)
			return name === null ? null : { name }
		}
		case 'color': {
			const color = clipColorAction.fn(payload)
			return color === null ? null : { color }
		}
		case 'setFade':
			return clipSetFadeAction.fn(payload, clipAttrs)
		case 'setAudio':
			return clipSetAudioAction.fn(payload, clipAttrs.audio)
		case 'setTransform':
			return clipSetTransformAction.fn(payload, clipAttrs.transform ?? defaultClipTransform)
	}
}

export const toAnimatedScalar = (value: unknown, fallback: AnimatedScalar): AnimatedScalar => {
	if (value && typeof value === 'object' && 'value' in value && typeof (value as { value?: unknown }).value === 'number') {
		return value as AnimatedScalar
	}

	return fallback
}

export const createClipUpdateOpacityEnvelope = (
	registry: ProjectRegistry,
	clipId: string,
	opacityPercent: number,
): PatchEnvelope | null => {
	const clip = registry.entitiesById[clipId]
	if (!clip || clip.type !== 'clip') {
		return null
	}

	const nextOpacity = clipUpdateOpacityAction.fn(opacityPercent)
	if (!nextOpacity) {
		return null
	}

	const project = getProjectForEntity(registry, clipId)
	if (!project) {
		return null
	}

	return {
		projectId: project.id,
		version: project.version + 1,
		patches: [
			{
				c: PATCH.SCALAR_SET,
				p: { id: clipId, path: 'opacity.value', value: nextOpacity.value },
			},
		],
	}
}
