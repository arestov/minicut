import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ClipAttrs, Entity, ResourceAttrs, TransformAttrs } from '../domain/types'

interface RenderedClip {
	id: string
	name: string
	resourceName: string
	resourceKind: ResourceAttrs['kind']
	resourceUrl: string
	mime: string
	opacity: number
	transform: TransformAttrs
	filters: string[]
}

const isRealMediaUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('/') || url.startsWith('./') || url.startsWith('http') || url.startsWith('data:')

const getEffectFilter = (effect: Entity): string | null => {
	const kind = String(effect.attrs.kind)
	const amount = Number(effect.attrs.amount) || 0

	if (kind === 'blur') {
		return `blur(${Math.round(amount * 10)}px)`
	}

	if (kind === 'sharpen') {
		return `contrast(${1 + amount}) saturate(${1 + amount * 0.5})`
	}

	if (kind === 'tint') {
		return `sepia(${amount}) saturate(${1 + amount})`
	}

	return null
}

export const RendererStage = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const cursor = session$.cursor.get()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const project$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = project$?.rootEntityId.get()
	const timelineId = rootEntityId ? projects$.entitiesById[rootEntityId].rels.activeTimeline.get() : null
	const trackIds = typeof timelineId === 'string'
		? projects$.entitiesById[timelineId].rels.tracks.get()
		: []
	const renderedClips: RenderedClip[] = []

	if (Array.isArray(trackIds)) {
		for (const trackId of trackIds) {
			const clipIds = projects$.entitiesById[trackId].rels.clips.get()
			if (!Array.isArray(clipIds)) {
				continue
			}

			for (const clipId of clipIds) {
				const clip$ = projects$.entitiesById[clipId]
				const attrs = clip$.attrs.get() as unknown as ClipAttrs
				if (cursor < attrs.start || cursor >= attrs.start + attrs.duration) {
					continue
				}

				const resourceId = clip$.rels.resource.get()
				const resourceAttrs = typeof resourceId === 'string'
					? projects$.entitiesById[resourceId].attrs.get() as unknown as ResourceAttrs
					: null
				const effectIds = clip$.rels.effects.get()
				const filters = Array.isArray(effectIds)
					? effectIds
						.map((effectId) => getEffectFilter(projects$.entitiesById[effectId].get() as Entity))
						.filter((filter): filter is string => Boolean(filter))
					: []

				renderedClips.push({
					id: clipId,
					name: attrs.name,
					resourceName: resourceAttrs?.name ?? attrs.name,
					resourceKind: resourceAttrs?.kind ?? 'image',
					resourceUrl: resourceAttrs?.url ?? '',
					mime: resourceAttrs?.mime ?? '',
					opacity: attrs.opacity.value,
					transform: attrs.transform,
					filters,
				})
			}
		}
	}

	return (
		<div className="ve-renderer" aria-label="Renderer stage">
			<div className="ve-renderer__safe-area">
				{renderedClips.length === 0 ? (
					<div className="ve-renderer__empty">No frame at cursor</div>
				) : (
					renderedClips.map((clip) => {
						const hasMedia = isRealMediaUrl(clip.resourceUrl)
						return (
							<div
								key={clip.id}
								className={`ve-renderer__layer ve-renderer__layer--${clip.resourceKind}`}
								style={{
									opacity: clip.opacity,
									filter: clip.filters.join(' '),
									transform: `translate(${clip.transform.x.value}px, ${clip.transform.y.value}px) scale(${clip.transform.scale.value}) rotate(${clip.transform.rotation.value}deg)`,
								}}
							>
								{hasMedia && clip.resourceKind === 'image' ? (
									<img src={clip.resourceUrl} alt={clip.resourceName} />
								) : null}
								{hasMedia && clip.resourceKind === 'video' ? (
									<video src={clip.resourceUrl} muted playsInline preload="metadata" />
								) : null}
								{hasMedia && clip.resourceKind === 'audio' ? (
									<div className="ve-renderer__audio" aria-label="Audio preview">
										<span>{clip.resourceName}</span>
										<audio src={clip.resourceUrl} preload="metadata" controls />
									</div>
								) : null}
								{!hasMedia ? (
									<>
										<strong>{clip.name}</strong>
										<span>{clip.resourceName}</span>
									</>
								) : null}
							</div>
						)
					})
				)}
			</div>
		</div>
	)
})
