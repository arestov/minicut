import { createEntityId } from './id'
import { createDefaultColorCorrectionAttrs } from './applyCommandDefaults'
import { assertEntity, assertProjectForEntity } from './validateCommand'
import { CMD, PATCH, type Command, type EffectAttrs, type Entity, type Command as AnyCommand } from './types'
import type { CommandHandler } from './applyCommandHelpers'

type CommandByCode<Code extends AnyCommand['c']> = Extract<Command, { c: Code }>

export const handleEffectAdd: CommandHandler<CommandByCode<typeof CMD.EFFECT_ADD>> = (registry, command) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const clip = assertEntity(registry, command.p.id)
	const effectId = createEntityId()
	const effects = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
	const baseAttrs: EffectAttrs = {
		name: command.p.name,
		kind: command.p.kind,
		enabled: true,
		...(command.p.amount !== undefined ? { amount: command.p.amount } : {}),
		...(command.p.color ? { color: command.p.color } : {}),
	}
	const effect: Entity = {
		id: effectId,
		type: 'effect',
		attrs: {
			...baseAttrs,
			...(command.p.kind === 'color-correction'
				? { params: { ...createDefaultColorCorrectionAttrs(), ...(command.p.params ?? {}) } }
				: command.p.params ? { params: command.p.params } : {}),
		},
		rels: { clip: clip.id },
	}

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [
				{ c: PATCH.ENTITY_SET, p: { entity: effect } },
				{ c: PATCH.REL_SPLICE, p: { id: clip.id, rel: 'effects', index: effects.length, deleteCount: 0, insert: [effectId] } },
			],
		},
		createdIds: { effectId },
	}
}

export const handleEffectUpdateAttrs: CommandHandler<CommandByCode<typeof CMD.EFFECT_UPDATE_ATTRS>> = (registry, command) => {
	const effect = assertEntity(registry, command.p.id)
	const project = assertProjectForEntity(registry, String(effect.rels.clip))

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [{ c: PATCH.ATTRS_MERGE, p: { id: effect.id, attrs: command.p.attrs } }],
		},
	}
}

export const handleEffectReorder: CommandHandler<CommandByCode<typeof CMD.EFFECT_REORDER>> = (registry, command) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const clip = assertEntity(registry, command.p.id)
	const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
	const fromIndex = effectIds.indexOf(command.p.effectId)
	const withoutEffect = effectIds.filter((id) => id !== command.p.effectId)
	const toIndex = Math.max(0, Math.min(command.p.toIndex, withoutEffect.length))
	const reordered = [...withoutEffect.slice(0, toIndex), command.p.effectId, ...withoutEffect.slice(toIndex)]

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [
				{ c: PATCH.REL_SPLICE, p: { id: clip.id, rel: 'effects', index: Math.max(0, fromIndex), deleteCount: 1, insert: [] } },
				{ c: PATCH.REL_SPLICE, p: { id: clip.id, rel: 'effects', index: reordered.indexOf(command.p.effectId), deleteCount: 0, insert: [command.p.effectId] } },
			],
		},
	}
}

export const handleEffectRemove: CommandHandler<CommandByCode<typeof CMD.EFFECT_REMOVE>> = (registry, command) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const clip = assertEntity(registry, command.p.id)
	assertEntity(registry, command.p.effectId)
	const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
	const effectIndex = effectIds.indexOf(command.p.effectId)

	if (effectIndex < 0) {
		throw new Error(`Effect ${command.p.effectId} is not attached to clip ${clip.id}`)
	}

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [
				{ c: PATCH.REL_SPLICE, p: { id: clip.id, rel: 'effects', index: effectIndex, deleteCount: 1, insert: [] } },
				{ c: PATCH.ENTITY_DELETE, p: { id: command.p.effectId } },
			],
		},
		deletedIds: [command.p.effectId],
	}
}
