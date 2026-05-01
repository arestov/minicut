import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ResourceAttrs } from '../domain/types'

interface ResourceRowProps {
	resourceId: string
}

const isPreviewableUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('/') || url.startsWith('./') || url.startsWith('http') || url.startsWith('data:')

const ResourceThumbnail = ({ attrs }: { attrs: ResourceAttrs }) => {
	const canPreview = isPreviewableUrl(attrs.url)

	if (canPreview && attrs.kind === 'image') {
		return <img className="ve-resource-thumb" src={attrs.url} alt={`${attrs.name} thumbnail`} />
	}

	if (canPreview && attrs.kind === 'video') {
		return <video className="ve-resource-thumb" src={attrs.url} aria-label={`${attrs.name} thumbnail`} muted playsInline preload="metadata" />
	}

	return (
		<div className={`ve-resource-thumb ve-resource-thumb--${attrs.kind}`} aria-label={`${attrs.kind} thumbnail`}>
			<span>{attrs.kind}</span>
		</div>
	)
}

const ResourceRow = observer(({ resourceId }: ResourceRowProps) => {
	const { projects$, actions } = useVideoEditor()
	const resource$ = projects$.entitiesById[resourceId]
	const attrs = resource$.attrs.get() as unknown as ResourceAttrs

	return (
		<li className="ve-resource-row">
			<ResourceThumbnail attrs={attrs} />
			<div className="ve-resource-row__content">
				<strong>{attrs.name}</strong>
				<div className="ve-resource-row__meta">
					<small>{attrs.kind} · {attrs.mime} · {attrs.duration.toFixed(1)}s</small>
					<div className="ve-resource-row__action-line">
						<button type="button" onClick={() => actions.addResourceToTimeline(resourceId)}>
							Add to timeline
						</button>
					</div>
				</div>
			</div>
		</li>
	)
})

export const MediaBin = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const resourceIds = rootEntityId
		? projects$.entitiesById[rootEntityId].rels.resources.get()
		: []
	const resources = Array.isArray(resourceIds) ? resourceIds : []

	return (
		<section className="ve-panel ve-media-bin" aria-label="Media bin">
			<div className="ve-panel__header">
				<h2>Media bin</h2>
				<label className="ve-import-button">
					<span>Import</span>
					<input
						type="file"
						aria-label="Import media files"
						accept="video/*,image/*,audio/*"
						multiple
						disabled={!activeProjectId}
						onChange={(event) => {
							if (event.currentTarget.files) {
								actions.importFiles(event.currentTarget.files)
								event.currentTarget.value = ''
							}
						}}
					/>
				</label>
			</div>
			<div className="ve-media-count">{resources.length} assets</div>
			<div className="ve-media-bin__body">
				{!activeProjectId ? (
					<p className="ve-empty">No active project.</p>
				) : resources.length === 0 ? (
					<p className="ve-empty">Import video, image, or audio files to populate the bin.</p>
				) : (
					<ul className="ve-resource-list">
						{resources.map((resourceId) => (
							<ResourceRow key={resourceId} resourceId={resourceId} />
						))}
					</ul>
				)}
			</div>
		</section>
	)
})
