import { getProjectForEntity } from '../domain/selectors'
import { PATCH, type PatchEnvelope, type ProjectRegistry } from '../domain/types'

const roundToTenths = (value: number): number => Math.round(value * 10) / 10

export const clipUpdateOpacityAction = {
	to: ['opacity'] as const,
	fn(opacityPercent: number): { value: number } | null {
		if (!Number.isFinite(opacityPercent)) {
			return null
		}

		return { value: roundToTenths(opacityPercent / 100) }
	},
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
