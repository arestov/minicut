import { buildDispatchResult } from './applyCommand'
import { applyPatchEnvelopeToRegistry } from './applyPatch'
import { createEmptyRegistry } from './createProject'
import { getClipIdsForTrack, getVideoTrack } from './selectors'
import { CMD, PATCH, type ColorCorrectionAttrs, type EffectAttrs, type ProjectRegistry } from './types'

const createProjectWithClip = (): { registry: ProjectRegistry; projectId: string; clipId: string } => {
	let registry = createEmptyRegistry()
	const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
	registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
	const projectId = String(createResult.createdIds?.projectId)
	const importResult = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'Source', kind: 'video', duration: 4, url: 'file:///source.webm' },
	})
	registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)
	const clipResult = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
	})
	registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

	return { registry, projectId, clipId: String(clipResult.createdIds?.clipId) }
}

describe('typed color effects', () => {
	it('creates a color correction effect with deterministic defaults', () => {
		let { registry, clipId } = createProjectWithClip()
		const effectResult = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Primary Correction', kind: 'color-correction' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectResult.envelope)
		const effectId = String(effectResult.createdIds?.effectId)
		const effect = registry.entitiesById[effectId]
		const attrs = effect.attrs as unknown as EffectAttrs
		const params = attrs.params as unknown as ColorCorrectionAttrs

		expect(effect.type).toBe('effect')
		expect(attrs).toMatchObject({ name: 'Primary Correction', kind: 'color-correction', enabled: true })
		expect(params.exposure.value).toBe(0)
		expect(params.contrast.value).toBe(1)
		expect(params.saturation.value).toBe(1)
		expect(registry.entitiesById[clipId].rels.effects).toContain(effectId)
	})

	it('updates effect attrs without touching clip relations', () => {
		let { registry, clipId } = createProjectWithClip()
		const effectResult = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Tint', kind: 'tint', amount: 0.25 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectResult.envelope)
		const effectId = String(effectResult.createdIds?.effectId)
		const updateResult = buildDispatchResult(registry, {
			c: CMD.EFFECT_UPDATE_ATTRS,
			p: {
				id: effectId,
				attrs: {
					amount: 0.8,
					color: { l: 0.7, c: 0.16, h: 145, alpha: 1, gamut: 'srgb' },
				},
			},
		})

		expect(updateResult.envelope.patches).toEqual([
			{
				c: PATCH.ATTRS_MERGE,
				p: expect.any(Object),
			},
		])
		registry = applyPatchEnvelopeToRegistry(registry, updateResult.envelope)
		const attrs = registry.entitiesById[effectId].attrs as unknown as EffectAttrs

		expect(attrs.amount).toBe(0.8)
		expect(attrs.color).toEqual({ l: 0.7, c: 0.16, h: 145, alpha: 1, gamut: 'srgb' })
		expect(registry.entitiesById[clipId].rels.effects).toEqual([effectId])
	})

	it('reorders effect ids with rel splice patches', () => {
		let { registry, projectId, clipId } = createProjectWithClip()
		const first = buildDispatchResult(registry, { c: CMD.EFFECT_ADD, p: { id: clipId, name: 'Blur', kind: 'blur', amount: 0.2 } })
		registry = applyPatchEnvelopeToRegistry(registry, first.envelope)
		const second = buildDispatchResult(registry, { c: CMD.EFFECT_ADD, p: { id: clipId, name: 'Tint', kind: 'tint', amount: 0.4 } })
		registry = applyPatchEnvelopeToRegistry(registry, second.envelope)
		const firstEffectId = String(first.createdIds?.effectId)
		const secondEffectId = String(second.createdIds?.effectId)

		const reorder = buildDispatchResult(registry, {
			c: CMD.EFFECT_REORDER,
			p: { id: clipId, effectId: secondEffectId, toIndex: 0 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, reorder.envelope)

		expect(reorder.envelope.projectId).toBe(projectId)
		expect(registry.entitiesById[clipId].rels.effects).toEqual([secondEffectId, firstEffectId])
	})

	it('rejects invalid OKLCH effect colors', () => {
		const { registry, clipId } = createProjectWithClip()

		expect(() => buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: {
				id: clipId,
				name: 'Bad tint',
				kind: 'tint',
				amount: 0.5,
				color: { l: 1.2, c: 0.1, h: 20, alpha: 1 },
			},
		})).toThrow('OKLCH lightness must be between 0 and 1')
	})

	it('keeps text-free media clip track lookup unchanged', () => {
		const { registry, projectId } = createProjectWithClip()
		const track = getVideoTrack(registry, registry.projects[projectId])
		expect(track).not.toBeNull()
		expect(getClipIdsForTrack(registry, String(track?.id))).toHaveLength(1)
	})
})
