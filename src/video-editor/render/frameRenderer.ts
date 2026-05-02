import type { ResourceAttrs } from '../domain/types'
import type { ClipFrameOperation } from './renderPlan'

interface RenderableResource {
	attrs: ResourceAttrs
	image?: HTMLImageElement
	video?: HTMLVideoElement
	loadPromise?: Promise<void>
}

interface PreparedFrameOperation {
	operation: ClipFrameOperation
	resource: RenderableResource
	sourceWidth: number
	sourceHeight: number
	drawSource?: CanvasImageSource
}

interface PrepareFrameOptions {
	videoSyncMode?: 'seek-each-frame' | 'realtime-playback'
	realtimeSeekTolerance?: number
}

const getOperationValue = <Value>(
	operations: ClipFrameOperation['operations'],
	type: ClipFrameOperation['operations'][number]['type'],
	fallback: Value,
): Value => operations.find((operation) => operation.type === type)?.value as Value ?? fallback

const getOperationEffects = (operations: ClipFrameOperation['operations']): string[] =>
	operations
		.filter((operation) => operation.type === 'effect')
		.map((operation) => String(operation.value))

const getEffectFilter = (effect: string): string => {
	if (effect === 'blur') {
		return 'blur(6px)'
	}
	if (effect === 'sharpen') {
		return 'contrast(1.25) saturate(1.125)'
	}
	if (effect === 'tint') {
		return 'sepia(0.35) saturate(1.35)'
	}

	return ''
}

const clampTimeToDuration = (time: number, duration: number): number => {
	if (!Number.isFinite(duration) || duration <= 0) {
		return Math.max(0, time)
	}

	return Math.min(Math.max(0, time), Math.max(0, duration - 0.001))
}

export const shouldSeekRealtimeVideoFrame = (
	currentTime: number,
	targetTime: number,
	tolerance: number,
): boolean =>
	!Number.isFinite(currentTime)
	|| !Number.isFinite(targetTime)
	|| Math.abs(currentTime - targetTime) > tolerance

const loadImageResource = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error(`Failed to load image resource ${url}`))
		image.src = url
	})

const loadVideoResource = (url: string): Promise<HTMLVideoElement> =>
	new Promise((resolve, reject) => {
		const video = document.createElement('video')
		video.muted = true
		video.playsInline = true
		video.preload = 'auto'
		video.onloadedmetadata = () => resolve(video)
		video.onerror = () => reject(new Error(`Failed to load video resource ${url}`))
		video.src = url
		video.load()
	})

const seekVideo = (video: HTMLVideoElement, targetTime: number): Promise<void> =>
	new Promise((resolve) => {
		const finish = (): void => {
			video.removeEventListener('seeked', onSeeked)
			globalThis.clearTimeout(timeoutId)
			resolve()
		}

		const onSeeked = (): void => {
			finish()
		}

		const timeoutId = globalThis.setTimeout(finish, 250)
		video.addEventListener('seeked', onSeeked, { once: true })

		try {
			const duration = Number.isFinite(video.duration) ? video.duration : 0
			video.currentTime = clampTimeToDuration(targetTime, duration)
		} catch {
			finish()
		}
	})

const canLoadRenderableResource = (resource: RenderableResource): boolean =>
	Boolean(resource.attrs.url) && resource.attrs.data?.status !== 'missing'

export const createResourceCache = (registryEntities: Record<string, { type: string; attrs: unknown } | undefined>): Map<string, RenderableResource> => {
	const cache = new Map<string, RenderableResource>()
	for (const entityId of Object.keys(registryEntities)) {
		const entity = registryEntities[entityId]
		if (!entity || entity.type !== 'resource') {
			continue
		}

		cache.set(entityId, {
			attrs: entity.attrs as ResourceAttrs,
		})
	}

	return cache
}

const ensureRenderableResource = async (
	resource: RenderableResource,
	kind: ClipFrameOperation['resourceKind'],
): Promise<void> => {
	if (kind === 'image') {
		if (resource.image || resource.loadPromise) {
			await resource.loadPromise
			return
		}

		resource.loadPromise = loadImageResource(resource.attrs.url).then((image) => {
			resource.image = image
		})
		await resource.loadPromise
		return
	}

	if (kind === 'video') {
		if (resource.video || resource.loadPromise) {
			await resource.loadPromise
			return
		}

		resource.loadPromise = loadVideoResource(resource.attrs.url).then((video) => {
			resource.video = video
		})
		await resource.loadPromise
	}
}

export const prepareFrameOperations = async (
	operations: ClipFrameOperation[],
	resourceCache: Map<string, RenderableResource>,
	width: number,
	height: number,
	options: PrepareFrameOptions = {},
): Promise<PreparedFrameOperation[]> => {
	const prepared: PreparedFrameOperation[] = []
	const videoSyncMode = options.videoSyncMode ?? 'seek-each-frame'
	const realtimeSeekTolerance = options.realtimeSeekTolerance ?? 0.15

	for (const operation of operations) {
		const resource = resourceCache.get(operation.resourceId)
		if (!resource) {
			continue
		}
		if (operation.resourceKind === 'audio') {
			prepared.push({
				operation,
				resource,
				sourceWidth: width,
				sourceHeight: height,
			})
			continue
		}
		if (!canLoadRenderableResource(resource)) {
			prepared.push({
				operation,
				resource,
				sourceWidth: Number(resource.attrs.width) || width,
				sourceHeight: Number(resource.attrs.height) || height,
			})
			continue
		}

		try {
			await ensureRenderableResource(resource, operation.resourceKind)
		} catch {
			prepared.push({
				operation,
				resource,
				sourceWidth: Number(resource.attrs.width) || width,
				sourceHeight: Number(resource.attrs.height) || height,
			})
			continue
		}
		if (operation.resourceKind === 'image' && resource.image) {
			prepared.push({
				operation,
				resource,
				drawSource: resource.image,
				sourceWidth: resource.image.naturalWidth || Number(resource.attrs.width) || width,
				sourceHeight: resource.image.naturalHeight || Number(resource.attrs.height) || height,
			})
			continue
		}

		if (operation.resourceKind === 'video' && resource.video) {
			if (videoSyncMode === 'seek-each-frame') {
				await seekVideo(resource.video, operation.sourceTime)
			} else {
				if (shouldSeekRealtimeVideoFrame(resource.video.currentTime, operation.sourceTime, realtimeSeekTolerance)) {
					await seekVideo(resource.video, operation.sourceTime)
				}
				void resource.video.play().catch(() => undefined)
			}
			prepared.push({
				operation,
				resource,
				drawSource: resource.video,
				sourceWidth: resource.video.videoWidth || Number(resource.attrs.width) || width,
				sourceHeight: resource.video.videoHeight || Number(resource.attrs.height) || height,
			})
			continue
		}

		prepared.push({
			operation,
			resource,
			sourceWidth: width,
			sourceHeight: height,
		})
	}

	return prepared
}

export const drawPreparedFrameOperations = (
	context: CanvasRenderingContext2D,
	preparedOperations: PreparedFrameOperation[],
	width: number,
	height: number,
	backgroundColor: string,
): void => {
	context.save()
	context.clearRect(0, 0, width, height)
	context.fillStyle = backgroundColor
	context.fillRect(0, 0, width, height)
	context.restore()

	for (const { operation, sourceWidth, sourceHeight, drawSource } of preparedOperations) {
		if (operation.resourceKind === 'audio') {
			continue
		}

		const transform = getOperationValue<{ x: number; y: number; scale: number; rotation: number }>(
			operation.operations,
			'transform',
			{ x: 0, y: 0, scale: 1, rotation: 0 },
		)
		const opacity = Math.max(0, Math.min(1, Number(getOperationValue(operation.operations, 'opacity', 1)) || 0))
		const filters = getOperationEffects(operation.operations)
			.map((effect) => getEffectFilter(effect))
			.filter(Boolean)
			.join(' ')

		context.save()
		context.globalAlpha = opacity
		context.filter = filters || 'none'
		context.translate(width / 2 + transform.x, height / 2 + transform.y)
		context.rotate((transform.rotation * Math.PI) / 180)
		context.scale(transform.scale, transform.scale)

		if (drawSource) {
			const fitScale = Math.min(width / sourceWidth, height / sourceHeight)
			const drawWidth = sourceWidth * fitScale
			const drawHeight = sourceHeight * fitScale
			context.drawImage(drawSource, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
		} else {
			context.fillStyle = '#e4e4e7'
			context.fillRect(-220, -40, 440, 80)
			context.fillStyle = '#18181b'
			context.font = '600 24px Segoe UI, sans-serif'
			context.textAlign = 'center'
			context.fillText(operation.resourceKind.toUpperCase(), 0, 8)
		}

		context.restore()
	}
}