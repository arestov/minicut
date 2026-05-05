import type { DispatchRuntimeTaskPayload } from '../../app/runtimeTaskFacade'

export const RESOURCE_TRANSFER_STATUS_FX = '$fx_resourceTransferStatus' as const
export const RESOURCE_REGISTER_LOCAL_FX = '$fx_registerLocalResource' as const

export type ResourceTransferStatusEffectData = {
	resourceId: string
	status: 'missing' | 'partial' | 'ready' | 'loading' | 'error'
	loadedBytes?: number
	requestedRanges?: readonly unknown[]
	loadedRanges?: readonly unknown[]
}

export type ResourceRegisterLocalEffectData = {
	resourceId: string
	kind: 'video' | 'audio' | 'image'
	mime: string
	duration: number
	size: number
	chunkSize: number
	ownerPeerId?: string | null
	sourceKind: 'local' | 'p2p'
	fallbackUrl: string
	name: string
}

export const createResourceTransferStatusEffectPayload = (
	data: ResourceTransferStatusEffectData,
): DispatchRuntimeTaskPayload => ({ data })

export const createResourceRegisterLocalEffectPayload = (
	file: File,
	data: ResourceRegisterLocalEffectData,
): DispatchRuntimeTaskPayload => ({
	runtimeRef: file,
	data,
})

export const isResourceTransferStatusEffectData = (value: unknown): value is ResourceTransferStatusEffectData => {
	const data = value as Partial<ResourceTransferStatusEffectData> | null
	return Boolean(data && typeof data.resourceId === 'string' && typeof data.status === 'string')
}
