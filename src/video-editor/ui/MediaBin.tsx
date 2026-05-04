import { observer } from '@legendapp/state/react'
import { Grid2X2, List, Plus, Search, Type, Upload } from 'lucide-react'
import { useState } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ResourceAttrs } from '../domain/types'
import type { ResourceTransferView } from '../media/resourceTransferManager'
import {
	getActiveProjectId$,
	getProjectResourceIds$,
	resourceAttrs$,
} from '../legend/observableSelectors'
import { Button, IconButton } from './ControlPrimitives'

interface ResourceRowProps {
	resourceId: string
}

const isPreviewableUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('/') || url.startsWith('./') || url.startsWith('http') || url.startsWith('data:')

const ResourceThumbnail = ({
	kind,
	name,
	url,
	transfer,
}: {
	kind: ResourceAttrs['kind']
	name: string
	url: string
	transfer?: ResourceTransferView
}) => {
	const resolvedUrl = transfer?.previewUrl || url
	const canPreview = isPreviewableUrl(resolvedUrl)

	if (canPreview && kind === 'image') {
		return <img className="ve-resource-thumb" src={resolvedUrl} alt={`${name} thumbnail`} />
	}

	if (canPreview && kind === 'video') {
		return <video className="ve-resource-thumb" src={resolvedUrl} aria-label={`${name} thumbnail`} muted playsInline preload="metadata" />
	}

	return (
		<div className={`ve-resource-thumb ve-resource-thumb--${kind}`} aria-label={`${kind} thumbnail`}>
			<span>{kind}</span>
		</div>
	)
}

const ResourceRow = observer(({ resourceId }: ResourceRowProps) => {
	const { projects$, actions, resourceTransfers$ } = useVideoEditor()
	const resource$ = resourceAttrs$(projects$, resourceId)
	const transfer = resourceTransfers$[resourceId].get() as ResourceTransferView | undefined
	const name = String(resource$.name.get())
	const kind = resource$.kind.get()
	const mime = String(resource$.mime.get())
	const duration = Number(resource$.duration.get())
	const url = String(resource$.url.get())
	const totalBytes = transfer?.totalBytes ?? Number(resource$.size.get() ?? 0)
	const progressPercent = Math.round((transfer?.progress ?? 0) * 100)
	const statusLabel = transfer
		? `${transfer.mode} · ${transfer.status}${totalBytes > 0 ? ` · ${progressPercent}%` : ''}`
		: null

	return (
		<li className="ve-resource-row">
			<ResourceThumbnail kind={kind} name={name} url={url} transfer={transfer} />
			<div className="ve-resource-row__content">
				<strong>{name}</strong>
				<div className="ve-resource-row__meta">
					<small>{kind} · {mime} · {duration.toFixed(1)}s</small>
					{statusLabel ? <small>{statusLabel}</small> : null}
					<div className="ve-resource-row__action-line">
						<IconButton
							type="button"
							icon={Plus}
							label="Add to timeline"
							variant="secondary"
							onClick={() => actions.addResourceToTimeline(resourceId)}
						>
							Add
						</IconButton>
					</div>
				</div>
			</div>
		</li>
	)
})

const TextTimelineActionRow = observer(() => {
	const { actions } = useVideoEditor()

	return (
		<li className="ve-resource-row ve-resource-row--text-action">
			<div className="ve-resource-thumb ve-resource-thumb--text-action" aria-hidden="true">
				<Type size={16} />
			</div>
			<div className="ve-resource-row__content">
				<div className="ve-resource-row__action-line">
					<Button
						type="button"
						variant="secondary"
						onClick={() => actions.addTextClip()}
						aria-label="Add Text to Timeline"
					>
						Add Text to Timeline
					</Button>
				</div>
			</div>
		</li>
	)
})

export const MediaBin = observer(() => {
	const [query, setQuery] = useState('')
	const [kindFilter, setKindFilter] = useState<ResourceAttrs['kind'] | 'all'>('all')
	const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = getActiveProjectId$(projects$, session$)
	const resources = getProjectResourceIds$(projects$, activeProjectId)
	const normalizedQuery = query.trim().toLowerCase()
	const filteredResources = resources.filter((resourceId) => {
		const resource$ = resourceAttrs$(projects$, resourceId)
		const kind = resource$.kind.get()
		const name = String(resource$.name.get())
		const mime = String(resource$.mime.get())
		const matchesKind = kindFilter === 'all' || kind === kindFilter
		const matchesQuery = normalizedQuery.length === 0
			|| name.toLowerCase().includes(normalizedQuery)
			|| mime.toLowerCase().includes(normalizedQuery)

		return matchesKind && matchesQuery
	})

	return (
		<section className="ve-panel ve-media-bin" aria-label="Media bin">
			<div className="ve-panel__header">
				<h2>Media bin</h2>
				<label className="ve-import-button">
					<Upload size={14} aria-hidden="true" />
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
			<div className="ve-media-controls" aria-label="Media filters">
				<label className="ve-search-field">
					<Search size={14} aria-hidden="true" />
					<span className="ve-sr-only">Search media</span>
					<input
						type="search"
						aria-label="Search media"
						placeholder="Search assets"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
				<select
					className="ve-select"
					aria-label="Filter media kind"
					value={kindFilter}
					onChange={(event) => setKindFilter(event.currentTarget.value as ResourceAttrs['kind'] | 'all')}
				>
					<option value="all">All media</option>
					<option value="video">Video</option>
					<option value="image">Images</option>
					<option value="audio">Audio</option>
				</select>
				<div className="ve-segmented-control" aria-label="Media view">
					<IconButton
						type="button"
						icon={List}
						label="List view"
						variant={viewMode === 'list' ? 'secondary' : 'ghost'}
						aria-pressed={viewMode === 'list'}
						onClick={() => setViewMode('list')}
					/>
					<IconButton
						type="button"
						icon={Grid2X2}
						label="Grid view"
						variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
						aria-pressed={viewMode === 'grid'}
						onClick={() => setViewMode('grid')}
					/>
				</div>
			</div>
			<div className="ve-media-count">{filteredResources.length} of {resources.length} assets</div>
			<div className="ve-media-bin__body">
				{!activeProjectId ? (
					<div className="ve-empty-state">
						<p className="ve-empty">No active project.</p>
						<button type="button" onClick={() => actions.createProject()}>New project</button>
					</div>
				) : (
					<>
						<ul className={`ve-resource-list ve-resource-list--${viewMode}`}>
							<TextTimelineActionRow />
							{filteredResources.map((resourceId) => (
								<ResourceRow key={resourceId} resourceId={resourceId} />
							))}
						</ul>
						{resources.length === 0 ? <p className="ve-empty">Import video, image, or audio files to populate the bin.</p> : null}
						{resources.length > 0 && filteredResources.length === 0 ? <p className="ve-empty">No assets match the current filters.</p> : null}
					</>
				)}
			</div>
		</section>
	)
})
