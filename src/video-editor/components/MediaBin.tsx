import { Grid2X2, List, Plus, Search, Type, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useActions } from '../../dkt-react-sync/hooks/useActions'
import { useMany } from '../../dkt-react-sync/hooks/useMany'
import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import { useRootAttrs } from '../../dkt-react-sync/hooks/useRootAttrs'
import { useScope } from '../../dkt-react-sync/hooks/useScope'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ResourceAttrs } from '../render/registryTypes'
import { Button, IconButton } from './ControlPrimitives'

const createSourceId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

const isPreviewableUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('/') || url.startsWith('./') || url.startsWith('http') || url.startsWith('data:')

const ResourceThumbnail = ({
	kind,
	name,
	url,
}: {
	kind: ResourceAttrs['kind']
	name: string
	url: string
}) => {
	const resolvedUrl = url
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
	resourceScope: ReactSyncScopeHandle
	onAddToTimeline: (sourceResourceId: string) => void
}

interface ResourceRenderAttrs {
	name?: unknown
	kind?: ResourceAttrs['kind']
	mime?: unknown
	duration?: unknown
	url?: unknown
	size?: unknown
}

const ResourceRow = ({ onAddToTimeline }: ResourceRowProps) => {
	const resourceAttrs = useAttrs(['sourceResourceId', 'name', 'kind', 'mime', 'duration', 'url', 'size']) as ResourceRenderAttrs & { sourceResourceId?: unknown }
	const sourceResourceId = typeof resourceAttrs.sourceResourceId === 'string' ? resourceAttrs.sourceResourceId : null
	const name = String(resourceAttrs.name)
	const kind = resourceAttrs.kind ?? 'video'
	const mime = String(resourceAttrs.mime)
	const duration = Number(resourceAttrs.duration)
	const url = String(resourceAttrs.url)
	const totalBytes = Number(resourceAttrs.size ?? 0)
	const statusLabel = totalBytes > 0 ? `${Math.round(totalBytes / 1024)} KB` : null
	const durationLabel = resourceAttrs.duration != null ? `${duration.toFixed(1)}s` : '—'

	return (
		<li className="ve-resource-row">
			<ResourceThumbnail kind={kind} name={name} url={url} />
			<div className="ve-resource-row__content">
				<strong>{name}</strong>
				<div className="ve-resource-row__meta">
								<small>{kind} | {mime} | {durationLabel}</small>
					{statusLabel ? <small>{statusLabel}</small> : null}
					<div className="ve-resource-row__action-line">
						<IconButton
							type="button"
							icon={Plus}
							label="Add to timeline"
							variant="secondary"
							disabled={!sourceResourceId}
							onClick={() => {
								if (sourceResourceId) {
									onAddToTimeline(sourceResourceId)
								}
							}}
						>
							Add
						</IconButton>
					</div>
				</div>
			</div>
		</li>
	)
}

const ResourceListItem = ({
	resourceScope,
	kindFilter,
	normalizedQuery,
	onMatchChange,
	onAddToTimeline,
}: ResourceRowProps & {
	kindFilter: ResourceAttrs['kind'] | 'all'
	normalizedQuery: string
	onMatchChange: (nodeId: string, matches: boolean) => void
}) => {
	const attrs = useAttrs(['kind', 'name', 'mime']) as Pick<ResourceRenderAttrs, 'kind' | 'name' | 'mime'>
	const kind = attrs.kind
	const name = String(attrs.name ?? '')
	const mime = String(attrs.mime ?? '')
	const matchesKind = kindFilter === 'all' || kind === kindFilter
	const matchesQuery = normalizedQuery.length === 0
		|| name.toLowerCase().includes(normalizedQuery)
		|| mime.toLowerCase().includes(normalizedQuery)
	const matches = matchesKind && matchesQuery

	useEffect(() => {
		onMatchChange(resourceScope._nodeId, matches)
		return () => onMatchChange(resourceScope._nodeId, false)
	}, [matches, onMatchChange, resourceScope._nodeId])

	if (!matches) {
		return null
	}

	return <ResourceRow resourceScope={resourceScope} onAddToTimeline={onAddToTimeline} />
}

const TextTimelineActionRow = () => {
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
}

const ProjectMediaList = ({
	kindFilter,
	normalizedQuery,
	viewMode,
}: {
	kindFilter: ResourceAttrs['kind'] | 'all'
	normalizedQuery: string
	viewMode: 'list' | 'grid'
}) => {
	const projectDispatch = useActions()
	const resourceScopes = useMany('resources')
	const [matchingResourceIds, setMatchingResourceIds] = useState<ReadonlySet<string>>(() => new Set())
	const handleAddToTimeline = useCallback((sourceResourceId: string) => {
		projectDispatch('addResourceToTimeline', { sourceResourceId })
	}, [projectDispatch])
	const handleMatchChange = useCallback((nodeId: string, matches: boolean) => {
		setMatchingResourceIds((current) => {
			const next = new Set(current)
			if (matches) {
				next.add(nodeId)
			} else {
				next.delete(nodeId)
			}
			return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next
		})
	}, [])

	return (
		<>
			<div className="ve-media-count">{matchingResourceIds.size} of {resourceScopes.length} assets</div>
			<div className="ve-media-bin__body">
				<ul className={`ve-resource-list ve-resource-list--${viewMode}`}>
					<TextTimelineActionRow />
					{resourceScopes.map((resourceScope) => (
						<ScopeContext.Provider key={resourceScope._nodeId} value={resourceScope}>
							<ResourceListItem
								resourceScope={resourceScope}
								kindFilter={kindFilter}
								normalizedQuery={normalizedQuery}
								onMatchChange={handleMatchChange}
								onAddToTimeline={handleAddToTimeline}
							/>
						</ScopeContext.Provider>
					))}
				</ul>
				{resourceScopes.length === 0 ? <p className="ve-empty">Import video, image, or audio files to populate the bin.</p> : null}
				{resourceScopes.length > 0 && matchingResourceIds.size === 0 ? <p className="ve-empty">No assets match the current filters.</p> : null}
			</div>
		</>
	)
}

const useImportFiles = () => {
	const dispatch = useActions()
	const scope = useScope()
	const runtime = useReactScopeRuntime()
	const { media, transfers, lifecycle, resourceChunkSize } = useVideoEditor()

	return useCallback(async (files: FileList | File[]) => {
		const ownerPeerId = transfers.getPeerId()
		for (const file of Array.from(files)) {
			const kind = media.getFileKind(file)
			if (!kind) continue

			const objectUrl = media.createObjectUrl(file)
			if (!objectUrl) continue
			lifecycle.registerObjectUrl(objectUrl, 'import')

			let duration = 0
			try {
				duration = await media.getImportedResourceDuration(objectUrl, kind)
			} catch {
				duration = 0
			}

			const sourceResourceId = createSourceId('resource')

			dispatch('importResource', {
				sourceResourceId,
				name: file.name,
				kind,
				url: objectUrl,
				mime: file.type || 'application/octet-stream',
				duration,
				size: file.size,
				source: {
					kind: 'local',
					ownerPeerId: typeof ownerPeerId === 'string' && ownerPeerId.length > 0 ? ownerPeerId : null,
				},
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: resourceChunkSize,
					chunks: {},
					ranges: { loaded: [[0, file.size]], requested: [] },
					loadedBytes: file.size,
				},
			})

			if (kind === 'video' && scope) {
				const attrs = runtime.readAttrs(scope, ['timelineDuration']) as { timelineDuration?: unknown }
				const isTimelineEmpty = typeof attrs.timelineDuration !== 'number' || attrs.timelineDuration <= 0
				if (isTimelineEmpty) {
					dispatch('addEmbeddedAudioToTimeline', { sourceResourceId })
				}
			}

			transfers.manager.registerLocalResource(sourceResourceId, file, {
				objectUrl,
				kind,
				mime: file.type || 'application/octet-stream',
				duration,
				size: file.size,
				chunkSize: resourceChunkSize,
				ownerPeerId,
				sourceKind: 'local',
				fallbackUrl: objectUrl,
				name: file.name,
			})
		}
	}, [dispatch, scope, runtime, media, transfers, lifecycle, resourceChunkSize])
}

const MediaBinPanel = ({
	activeProjectId,
	children,
	kindFilter,
	query,
	setKindFilter,
	setQuery,
	setViewMode,
	viewMode,
}: {
	activeProjectId: string | null
	children: React.ReactNode
	kindFilter: ResourceAttrs['kind'] | 'all'
	query: string
	setKindFilter: (value: ResourceAttrs['kind'] | 'all') => void
	setQuery: (value: string) => void
	setViewMode: (value: 'list' | 'grid') => void
	viewMode: 'list' | 'grid'
}) => {
	const importFiles = useImportFiles()

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
								importFiles(event.currentTarget.files)
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
			{children}
		</section>
	)
}

const MediaBinEmptyState = () => {
	const { actions } = useVideoEditor()

	return (
		<>
			<div className="ve-media-count">0 of 0 assets</div>
			<div className="ve-media-bin__body">
				<div className="ve-empty-state">
					<p className="ve-empty">No active project.</p>
					<button type="button" onClick={() => actions.createProject()}>New project</button>
				</div>
			</div>
		</>
	)
}

export const MediaBin = () => {
	const [query, setQuery] = useState('')
	const [kindFilter, setKindFilter] = useState<ResourceAttrs['kind'] | 'all'>('all')
	const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
	const normalizedQuery = query.trim().toLowerCase()
	// activeProjectId lives on session scope; read via root hook (we're inside ActiveProjectScope)
	const rootAttrs = useRootAttrs(['activeProjectId']) as { activeProjectId?: unknown }
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null

	return (
		<MediaBinPanel
			activeProjectId={activeProjectId}
			kindFilter={kindFilter}
			query={query}
			setKindFilter={setKindFilter}
			setQuery={setQuery}
			setViewMode={setViewMode}
			viewMode={viewMode}
		>
			{activeProjectId
				? <ProjectMediaList kindFilter={kindFilter} normalizedQuery={normalizedQuery} viewMode={viewMode} />
				: <MediaBinEmptyState />
			}
		</MediaBinPanel>
	)
}

