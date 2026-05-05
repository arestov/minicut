import type { DktEffectActionPatch } from '../effectActions'
import type { DktTextActionPatch } from '../textActions'
import type { MiniCutDktClipProxyInput } from '../runtime/createMiniCutDktRuntime'
import type { AnimatedScalar, ClipAttrs, EffectAttrs, Entity, PatchEnvelope, ProjectRegistry, TextAttrs } from '../../domain/types'
import { PATCH } from '../../domain/types'

type DktReplicaRuntime = {
	dispatchClipAction: (clip: MiniCutDktClipProxyInput, actionName: 'syncAttrs', payload: Partial<ClipAttrs>) => Promise<void>
	dispatchTextAction: (text: { sourceTextId: string } & DktTextActionPatch, actionName: 'updateText', payload: DktTextActionPatch) => Promise<void>
	dispatchEffectAction: (effect: { sourceEffectId: string } & DktEffectActionPatch, actionName: 'updateAttrs', payload: DktEffectActionPatch) => Promise<void>
}

const toAnimatedScalar = (value: unknown): AnimatedScalar => {
	if (value && typeof value === 'object' && typeof (value as Partial<AnimatedScalar>).value === 'number') {
		return value as AnimatedScalar
	}

	return { value: typeof value === 'number' ? value : 1 }
}

const toClipProxy = (entity: Entity): MiniCutDktClipProxyInput => {
	const attrs = entity.attrs as Partial<ClipAttrs>
	return {
		sourceClipId: entity.id,
		name: typeof attrs.name === 'string' ? attrs.name : entity.id,
		color: typeof attrs.color === 'string' ? attrs.color : undefined,
		start: typeof attrs.start === 'number' ? attrs.start : 0,
		in: typeof attrs.in === 'number' ? attrs.in : 0,
		duration: typeof attrs.duration === 'number' ? attrs.duration : 1,
		fadeIn: typeof attrs.fadeIn === 'number' ? attrs.fadeIn : undefined,
		fadeOut: typeof attrs.fadeOut === 'number' ? attrs.fadeOut : undefined,
		audio: attrs.audio,
		opacity: toAnimatedScalar(attrs.opacity),
		transform: attrs.transform,
	}
}

const toTextPatch = (entity: Entity): { sourceTextId: string } & DktTextActionPatch => ({
	sourceTextId: entity.id,
	...(entity.attrs as Partial<TextAttrs>),
})

const toEffectPatch = (entity: Entity): { sourceEffectId: string } & DktEffectActionPatch => ({
	sourceEffectId: entity.id,
	...(entity.attrs as Partial<EffectAttrs>),
})

export const getDktReplicaSyncEntityIds = (envelope: PatchEnvelope): Set<string> => {
	const ids = new Set<string>()
	for (const patch of envelope.patches) {
		if (patch.c === PATCH.REGISTRY_SET) {
			for (const entityId of Object.keys(patch.p.registry.entitiesById)) {
				ids.add(entityId)
			}
			continue
		}
		if (patch.c === PATCH.ENTITY_SET || patch.c === PATCH.ATTRS_MERGE || patch.c === PATCH.SCALAR_SET) {
			ids.add(patch.p.id)
		}
	}
	return ids
}

export const hasDktReplicaSyncTargets = (envelope: PatchEnvelope, registry: ProjectRegistry): boolean => {
	for (const id of getDktReplicaSyncEntityIds(envelope)) {
		const entity = registry.entitiesById[id]
		if (entity?.type === 'clip' || entity?.type === 'text' || entity?.type === 'effect') {
			return true
		}
	}
	return false
}

export const syncAuthorityEnvelopeToDktReplica = async (
	runtime: DktReplicaRuntime,
	registry: ProjectRegistry,
	envelope: PatchEnvelope,
): Promise<void> => {
	for (const id of getDktReplicaSyncEntityIds(envelope)) {
		const entity = registry.entitiesById[id]
		if (!entity) {
			continue
		}

		if (entity.type === 'clip') {
			const clip = toClipProxy(entity)
			await runtime.dispatchClipAction(clip, 'syncAttrs', clip)
			continue
		}

		if (entity.type === 'text') {
			const text = toTextPatch(entity)
			await runtime.dispatchTextAction(text, 'updateText', text)
			continue
		}

		if (entity.type === 'effect') {
			const effect = toEffectPatch(entity)
			await runtime.dispatchEffectAction(effect, 'updateAttrs', effect)
		}
	}
}
