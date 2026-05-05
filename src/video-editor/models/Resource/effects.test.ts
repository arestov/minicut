import { describe, expect, it } from 'vitest'
import { createResourceRegisterLocalEffectPayload, createResourceTransferStatusEffectPayload, isResourceTransferStatusEffectData, RESOURCE_REGISTER_LOCAL_FX } from './effects'
import { createRuntimeTaskFacade } from '../../app/runtimeTaskFacade'

describe('Resource model effects', () => {
	it('keeps transfer status data serializable', () => {
		const payload = createResourceTransferStatusEffectPayload({
			resourceId: 'resource:1',
			status: 'partial',
			loadedBytes: 128,
		})

		expect(payload).toEqual({ data: { resourceId: 'resource:1', status: 'partial', loadedBytes: 128 } })
		expect(isResourceTransferStatusEffectData(payload.data)).toBe(true)
	})

	it('keeps local files behind runtime refs', () => {
		const file = new File(['video'], 'clip.webm', { type: 'video/webm' })
		const tasks = createRuntimeTaskFacade()
		const task = tasks.dispatchTask(RESOURCE_REGISTER_LOCAL_FX, createResourceRegisterLocalEffectPayload(file, {
			resourceId: 'resource:1',
			kind: 'video',
			mime: 'video/webm',
			duration: 4,
			size: file.size,
			chunkSize: 1024,
			ownerPeerId: null,
			sourceKind: 'local',
			fallbackUrl: 'blob:test',
			name: file.name,
		}))

		expect(task.payload.data).toMatchObject({ resourceId: 'resource:1', sourceKind: 'local' })
		expect(tasks.consumeRuntimeRef(String(task.payload.runtimeRefId))).toBe(file)
	})
})
