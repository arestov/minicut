import { bench, describe } from 'vitest'
import { CMD, PATCH, type Patch } from '../domain/types'
import { MemoryWorkerAuthority } from './memoryWorker'

const CLIP_COUNT = 60
const EFFECT_CHURN_STEPS = 240
const MOVE_STEPS = 240

const countRenderIndexPatches = (patches: Patch[]): number =>
	patches.reduce((count, patch) => {
		if (patch.c !== PATCH.ENTITY_SET) {
			return count
		}

		return patch.p.entity.type === 'render-index' ? count + 1 : count
	}, 0)

const createDenseTimeline = () => {
	const worker = new MemoryWorkerAuthority()
	const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Render index bench' } })
	const projectId = String(projectResult.createdIds?.projectId)
	const resourceResult = worker.dispatch({
		c: CMD.RESOURCE_IMPORT,
		p: {
			projectId,
			name: 'bench-resource',
			kind: 'video',
			duration: 120,
		},
	})
	const resourceId = String(resourceResult.createdIds?.resourceId)
	const clipIds: string[] = []

	for (let index = 0; index < CLIP_COUNT; index += 1) {
		const clipResult = worker.dispatch({
			c: CMD.TIMELINE_ADD_CLIP,
			p: {
				projectId,
				resourceId,
			},
		})
		clipIds.push(String(clipResult.createdIds?.clipId))
	}

	return { worker, clipIds }
}

describe('render-index projection benchmark', () => {
	bench('effect churn keeps render-index patch count at zero', () => {
		const { worker, clipIds } = createDenseTimeline()
		const effectByClip = new Map<string, string>()

		for (const clipId of clipIds) {
			const effectResult = worker.dispatch({
				c: CMD.EFFECT_ADD,
				p: { id: clipId, name: 'bench-effect', kind: 'blur', amount: 0.2 },
			})
			effectByClip.set(clipId, String(effectResult.createdIds?.effectId))
		}

		let renderIndexPatchCount = 0
		let effectCommandCount = 0
		for (let step = 0; step < EFFECT_CHURN_STEPS; step += 1) {
			const clipId = clipIds[step % clipIds.length]
			const effectId = effectByClip.get(clipId)
			if (!effectId) {
				throw new Error(`Missing effect for clip ${clipId}`)
			}

			const removeResult = worker.dispatch({
				c: CMD.EFFECT_REMOVE,
				p: { id: clipId, effectId },
			})
			renderIndexPatchCount += countRenderIndexPatches(removeResult.envelope.patches)
			effectCommandCount += 1

			const addResult = worker.dispatch({
				c: CMD.EFFECT_ADD,
				p: { id: clipId, name: 'bench-effect', kind: 'blur', amount: 0.2 + (step % 10) * 0.01 },
			})
			renderIndexPatchCount += countRenderIndexPatches(addResult.envelope.patches)
			effectByClip.set(clipId, String(addResult.createdIds?.effectId))
			effectCommandCount += 1
		}

		if (renderIndexPatchCount !== 0) {
			throw new Error(
				`Expected zero render-index projection patches for ${effectCommandCount} effect commands, got ${renderIndexPatchCount}`,
			)
		}
	}, { iterations: 3, warmupIterations: 0 })

	bench('temporal clip moves emit render-index projection patches', () => {
		const { worker, clipIds } = createDenseTimeline()
		const targetClipId = clipIds[Math.floor(clipIds.length / 2)]

		let renderIndexPatchCount = 0
		for (let step = 0; step < MOVE_STEPS; step += 1) {
			const moveResult = worker.dispatch({
				c: CMD.TIMELINE_MOVE_CLIP,
				p: { id: targetClipId, delta: 0.01 },
			})
			renderIndexPatchCount += countRenderIndexPatches(moveResult.envelope.patches)
		}

		if (renderIndexPatchCount === 0) {
			throw new Error(`Expected render-index projection patches for ${MOVE_STEPS} temporal moves`)
		}
	}, { iterations: 3, warmupIterations: 0 })
})
