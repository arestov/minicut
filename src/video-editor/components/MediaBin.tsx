import { Grid2X2, List, Plus, Search, Type, Upload } from 'lucide-react'
import { useState } from 'react'
import type { ResourceAttrs } from '../domain/types'
import type { ResourceTransferView } from '../media/resourceTransferManager'
import {
	EditorScopeProvider,
	ROOT_SCOPE,
	useEditorActions,
	useEditorAttrs,
	useEditorComp,
	useEditorMany,
	useEditorOne,
	useEditorRenderRuntime,
} from '../render-sync'
import type { EditorScope } from '../render-sync/EditorScope'
import { Button, IconButton } from './ControlPrimitives'

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
	transfer?: ResourceTransferView | null
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

interface ResourceRowProps {
	resourceScope: EditorScope
}

interface ResourceRenderAttrs {
	name?: unknown
	kind?: ResourceAttrs['kind']
	mime?: unknown
	duration?: unknown
	url?: unknown
	size?: unknown
}

const ResourceRow = ({ resourceScope }: ResourceRowProps) => {
	const dispatch = useEditorActions(resourceScope)
	const resourceAttrs = useEditorAttrs<ResourceRenderAttrs>(['name', 'kind', 'mime', 'duration', 'url', 'size'], resourceScope)
	const transfer = useEditorComp<ResourceTransferView | null>('resourceTransfer', resourceScope)
	const name = String(resourceAttrs.name)
	const kind = resourceAttrs.kind ?? 'video'
	const mime = String(resourceAttrs.mime)
	const duration = Number(resourceAttrs.duration)
	const url = String(resourceAttrs.url)
	const totalBytes = transfer?.totalBytes ?? Number(resourceAttrs.size ?? 0)
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
							onClick={() => dispatch('addResourceToTimeline')}
						>
							Add
						</IconButton>
					</div>
				</div>
			</div>
		</li>
	)
}

const TextTimelineActionRow = () => {
	const dispatch = useEditorActions(ROOT_SCOPE)

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
						onClick={() => dispatch('addTextClip')}
						aria-label="Add Text to Timeline"
					>
						Add Text to Timeline
					</Button>
				</div>
			</div>
		</li>
	)
}

const ProjectMediaList = ({
	kindFilter,
	normalizedQuery,
	projectScope,
	viewMode,
}: {
	kindFilter: ResourceAttrs['kind'] | 'all'
	normalizedQuery: string
	projectScope: EditorScope
	viewMode: 'list' | 'grid'
}) => {
	const runtime = useEditorRenderRuntime()
	const resourceScopes = useEditorMany('resources', projectScope)
	const filteredResourceScopes = resourceScopes.filter((resourceScope) => {
		const attrs = runtime.readAttrs(resourceScope, ['kind', 'name', 'mime'])
		const kind = attrs.kind
		const name = String(attrs.name ?? '')
		const mime = String(attrs.mime ?? '')
		const matchesKind = kindFilter === 'all' || kind === kindFilter
		const matchesQuery = normalizedQuery.length === 0
			|| name.toLowerCase().includes(normalizedQuery)
			|| mime.toLowerCase().includes(normalizedQuery)

		return matchesKind && matchesQuery
	})

	return (
		<>
			<div className="ve-media-count">{filteredResourceScopes.length} of {resourceScopes.length} assets</div>
			<div className="ve-media-bin__body">
				<ul className={`ve-resource-list ve-resource-list--${viewMode}`}>
					<TextTimelineActionRow />
					{filteredResourceScopes.map((resourceScope) => (
						<EditorScopeProvider key={resourceScope.nodeId} scope={resourceScope}>
							<ResourceRow resourceScope={resourceScope} />
						</EditorScopeProvider>
					))}
				</ul>
				{resourceScopes.length === 0 ? <p className="ve-empty">Import video, image, or audio files to populate the bin.</p> : null}
				{resourceScopes.length > 0 && filteredResourceScopes.length === 0 ? <p className="ve-empty">No assets match the current filters.</p> : null}
			</div>
		</>
	)
}

export const MediaBin = () => {
	const [query, setQuery] = useState('')
	const [kindFilter, setKindFilter] = useState<ResourceAttrs['kind'] | 'all'>('all')
	const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
	const rootDispatch = useEditorActions(ROOT_SCOPE)
	const rootAttrs = useEditorAttrs<{ activeProjectId?: unknown }>(['activeProjectId'], ROOT_SCOPE)
	const activeProjectScope = useEditorOne('activeProject', ROOT_SCOPE)
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
	const normalizedQuery = query.trim().toLowerCase()

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
								rootDispatch('importFiles', { files: event.currentTarget.files })
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
			{!activeProjectId || !activeProjectScope ? (
				<>
					<div className="ve-media-count">0 of 0 assets</div>
					<div className="ve-media-bin__body">
						<div className="ve-empty-state">
							<p className="ve-empty">No active project.</p>
							<button type="button" onClick={() => rootDispatch('createProject')}>New project</button>
						</div>
					</div>
				</>
			) : (
				<EditorScopeProvider scope={activeProjectScope}>
					<ProjectMediaList
						kindFilter={kindFilter}
						normalizedQuery={normalizedQuery}
						projectScope={activeProjectScope}
						viewMode={viewMode}
					/>
				</EditorScopeProvider>
			)}
		</section>
	)
}
