import { buildDispatchResult } from './applyCommand'
import { applyPatchEnvelopeToRegistry } from './applyPatch'
import { createEmptyRegistry } from './createProject'
import { CMD, type Command } from './types'

describe('command validation', () => {
	it('rejects a clip insertion with a missing resource before producing patches', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, {
			c: CMD.PROJECT_CREATE,
			p: { title: 'Validation project' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)

		const invalidCommand: Command = {
			c: CMD.TIMELINE_ADD_CLIP,
			p: {
				projectId: String(createResult.createdIds?.projectId),
				resourceId: 'resource:missing',
			},
		}

		expect(() => buildDispatchResult(registry, invalidCommand)).toThrow('Unknown entity resource:missing')
		expect(registry.projects[String(createResult.createdIds?.projectId)].version).toBe(1)
	})

	it('rejects opacity updates outside the planned animated scalar bounds', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Clip source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		expect(() =>
			buildDispatchResult(registry, {
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					projectId,
					clipId: String(clipResult.createdIds?.clipId),
					attrs: { opacity: { value: 1.5 } },
				},
			}),
		).toThrow('Opacity must be between 0 and 1')
	})
})