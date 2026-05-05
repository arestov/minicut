import { describe, expect, it, vi } from 'vitest'
import { createEmptyRegistry } from '../../domain/createProject'
import { PATCH, type PatchEnvelope, type ProjectRegistry } from '../../domain/types'
import { hasDktReplicaSyncTargets, syncAuthorityEnvelopeToDktReplica } from './syncAuthorityEnvelope'

const clipEntity = {
	id: 'clip:1',
	type: 'clip' as const,
	attrs: {
		name: 'Clip 1',
		color: '#123456',
		start: 1,
		in: 0.5,
		duration: 4,
		fadeIn: 0.2,
		fadeOut: 0.3,
		audio: { gain: 0.8, pan: 0.1 },
		opacity: { value: 0.75 },
		transform: {
			x: { value: 10 },
			y: { value: 20 },
			scale: { value: 1.1 },
			rotation: { value: 5 },
		},
	},
	rels: {},
}

describe('syncAuthorityEnvelopeToDktReplica', () => {
	it('syncs changed authority clip entities into the DKT runtime', async () => {
		const registry: ProjectRegistry = {
			...createEmptyRegistry(),
			projects: { 'project:1': { id: 'project:1', version: 1, rootEntityId: 'root:1' } },
			entitiesById: { [clipEntity.id]: clipEntity },
		}
		const envelope: PatchEnvelope = {
			projectId: 'project:1',
			version: 2,
			patches: [{ c: PATCH.ATTRS_MERGE, p: { id: clipEntity.id, attrs: { start: 1 } } }],
		}
		const runtime = {
			dispatchClipAction: vi.fn(async () => {}),
			dispatchTextAction: vi.fn(async () => {}),
			dispatchEffectAction: vi.fn(async () => {}),
		}

		expect(hasDktReplicaSyncTargets(envelope, registry)).toBe(true)
		await syncAuthorityEnvelopeToDktReplica(runtime, registry, envelope)

		expect(runtime.dispatchClipAction).toHaveBeenCalledWith(expect.objectContaining({
			sourceClipId: 'clip:1',
			name: 'Clip 1',
			start: 1,
			in: 0.5,
			duration: 4,
		}), 'syncAttrs', expect.objectContaining({ sourceClipId: 'clip:1', start: 1 }))
	})

	it('ignores envelopes that do not touch syncable entities', () => {
		const registry = createEmptyRegistry()
		const envelope: PatchEnvelope = {
			projectId: 'project:1',
			version: 2,
			patches: [{ c: PATCH.WORKSPACE_ACTIVE_PROJECT_SET, p: { projectId: 'project:1' } }],
		}

		expect(hasDktReplicaSyncTargets(envelope, registry)).toBe(false)
	})
})
