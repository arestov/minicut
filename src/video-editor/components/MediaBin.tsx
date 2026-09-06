import { Grid2X2, List, Plus, Search, Type, Upload } from "lucide-react";
import { useCallback, useContext, useEffect, useState } from "react";
import { One } from "../../dkt-react-sync/components/One";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { useActions } from "../../dkt-react-sync/hooks/useActions";
import { useAttrs } from "../../dkt-react-sync/hooks/useAttrs";
import { useMany } from "../../dkt-react-sync/hooks/useMany";
import { useScope } from "../../dkt-react-sync/hooks/useScope";
import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";
import { useVideoEditor } from "../app/VideoEditorContext";
import type { MediaImportEntry } from "../app/actionRuntimeTypes";
import type { ResourceAttrs } from "../render/registryTypes";
import { Button, IconButton } from "./ControlPrimitives";

const isPreviewableUrl = (url: string): boolean =>
	url.startsWith("blob:") ||
	url.startsWith("/") ||
	url.startsWith("./") ||
	url.startsWith("http") ||
	url.startsWith("data:");

const ResourceThumbnail = ({
	kind,
	name,
	url,
}: {
	kind: ResourceAttrs["kind"];
	name: string;
	url: string;
}) => {
	const resolvedUrl = url;
	const canPreview = isPreviewableUrl(resolvedUrl);

	if (canPreview && kind === "image") {
		return (
			<img
				className="ve-resource-thumb"
				src={resolvedUrl}
				alt={`${name} thumbnail`}
			/>
		);
	}

	if (canPreview && kind === "video") {
		return (
			<video
				className="ve-resource-thumb"
				src={resolvedUrl}
				aria-label={`${name} thumbnail`}
				muted
				playsInline
				preload="metadata"
			/>
		);
	}

	return (
		<div
			className={`ve-resource-thumb ve-resource-thumb--${kind}`}
			aria-label={kind === "audio" ? "audio thumbnail" : `${name} thumbnail`}
		>
			<span>{kind}</span>
		</div>
	);
};

interface ResourceRowProps {
	resourceScope: ReactSyncScopeHandle;
	onAddToTimeline: (resourceId: string) => void;
}

interface ResourceRenderAttrs {
	name?: unknown;
	kind?: ResourceAttrs["kind"];
	mime?: unknown;
	duration?: unknown;
	url?: unknown;
	size?: unknown;
	sourceKind?: unknown;
	status?: unknown;
	localMediaStatus?: unknown;
	localMediaAvailability?: unknown;
	originalAccessStatus?: unknown;
}

const RELINK_REASON_LABELS: Record<string, string> = {
	"invalid-metadata": "Media metadata could not be verified.",
	"media-kind-mismatch": "The media type does not match.",
	"stream-topology-mismatch": "The audio/video streams do not match.",
	"source-range-too-short": "The file is shorter than the source range used by the timeline.",
	"duration-differs": "Duration differs from the original.",
	"frame-rate-differs": "Frame rate differs from the original.",
	"timebase-differs": "Timebase differs from the original.",
	"dimensions-differ": "Frame dimensions differ from the original.",
	"audio-properties-differ": "Audio properties differ from the original.",
	"identity-not-proven": "File identity could not be proven.",
	"identity-mismatch": "File content differs from the original.",
};

const RecoveryTaskActions = ({ resourceId }: { resourceId: string }) => {
	const editor = useVideoEditor(); const taskDispatch = useActions();
	const attrs = useAttrs(["operationId", "bootId", "intent", "phase", "reasonCode", "errorMessage", "compatibility"]) as Record<string, unknown>;
	const phase = String(attrs.phase ?? "created"); const intent = attrs.intent === "replace-source" ? "replace-source" : "locate-original";
	const busy = phase === "inspecting" || phase === "committing";
	const reason = typeof attrs.reasonCode === "string" ? RELINK_REASON_LABELS[attrs.reasonCode] ?? attrs.reasonCode : typeof attrs.errorMessage === "string" ? attrs.errorMessage : null;
	return <div className="ve-media-recovery" aria-busy={busy}>
		{reason && (phase === "rejected" || phase === "failed") ? <p role="alert">{reason}</p> : null}
		{phase === "awaiting-confirmation" ? <div role="dialog" aria-modal="true" aria-label="Confirm source replacement"><p>{reason ?? "The replacement differs from the original."}</p><Button type="button" disabled={busy} onClick={() => taskDispatch("requestCommit", { operationId: attrs.operationId, updatedAt: Date.now() })}>Confirm replacement</Button></div> : null}
		{phase === "failed" || phase === "rejected" || phase === "cancelled" ? <Button type="button" variant="outline" onClick={() => void editor.startMediaRecovery?.(resourceId, intent)}>Retry</Button> : null}
		{busy ? <small role="status">{phase === "committing" ? "Saving source…" : "Checking source…"}</small> : null}
	</div>;
};

const ResourceRow = ({ onAddToTimeline }: ResourceRowProps) => {
	const editor = useVideoEditor();
	const { resolveResourceUrl } = editor;
	const scope = useContext(ScopeContext);
	const resourceAttrs = useAttrs([
		"name",
		"kind",
		"mime",
		"duration",
		"url",
		"size",
		"sourceKind",
		"sourceRef",
		"assetStorageKind",
		"assetRef",
		"status",
		"localMediaStatus",
		"localMediaAvailability",
		"originalAccessStatus",
	]) as ResourceRenderAttrs;
	const resourceId = scope?._nodeId ?? null;
	const name = String(resourceAttrs.name);
	const kind = resourceAttrs.kind ?? "video";
	const mime = String(resourceAttrs.mime);
	const duration = Number(resourceAttrs.duration);
	const url =
		resourceId && typeof resourceAttrs.url === "string"
			? resolveResourceUrl(resourceId, resourceAttrs.url)
			: String(resourceAttrs.url ?? "");
	const totalBytes = Number(resourceAttrs.size ?? 0);
	const statusLabel =
		totalBytes > 0 ? `${Math.round(totalBytes / 1024)} KB` : null;
	const mediaStatus = typeof resourceAttrs.localMediaStatus === "string" ? resourceAttrs.localMediaStatus : "unknown";
	const availability = typeof resourceAttrs.localMediaAvailability === "string" ? resourceAttrs.localMediaAvailability : mediaStatus;
	const originalAccess = typeof resourceAttrs.originalAccessStatus === "string" ? resourceAttrs.originalAccessStatus : "unknown";
	const durationLabel =
		resourceAttrs.duration != null ? `${duration.toFixed(1)}s` : "-";

	return (
		<li className="ve-resource-row">
			<ResourceThumbnail kind={kind} name={name} url={url} />
			<div className="ve-resource-row__content">
				<strong>{name}</strong>
				<div className="ve-resource-row__meta">
					<small>
						{kind} | {mime} | {durationLabel}
					</small>
					{availability === "ready-project-copy" ? <small>Using project copy</small> : null}
					{originalAccess === "denied" ? <small>Access denied</small> : null}
					{mediaStatus !== "unknown" && mediaStatus !== "ready-project-copy" && mediaStatus !== "permission-denied" ? <small>{mediaStatus}</small> : null}
					{statusLabel ? <small>{statusLabel}</small> : null}
					<div className="ve-resource-row__action-line">
						<IconButton
							type="button"
							icon={Plus}
							label="Add to timeline"
							variant="secondary"
							disabled={!resourceId}
							onClick={() => {
								if (resourceId) {
									onAddToTimeline(resourceId);
								}
							}}
						>
							Add
						</IconButton>
						{originalAccess === "prompt" || originalAccess === "denied" ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => { if (resourceId) void editor.requestResourceAccess?.(resourceId); }}
							>
								{originalAccess === "prompt" ? "Grant access" : "Try again"}
							</Button>
						) : null}
						{originalAccess === "missing" || originalAccess === "denied" ? <Button type="button" variant="outline" onClick={() => resourceId && void editor.startMediaRecovery?.(resourceId, "locate-original")}>{originalAccess === "missing" ? "Locate file" : "Locate original"}</Button> : null}
						<Button type="button" variant="outline" disabled={!resourceId} onClick={() => resourceId && void editor.startMediaRecovery?.(resourceId, "replace-source")}>Replace source</Button>
					</div>
					{resourceId ? <One rel="activeMediaRecoveryTask" fallback={null}><RecoveryTaskActions resourceId={resourceId} /></One> : null}
				</div>
			</div>
		</li>
	);
};

const ResourceListItem = ({
	resourceScope,
	kindFilter,
	normalizedQuery,
	onMatchChange,
	onAddToTimeline,
}: ResourceRowProps & {
	kindFilter: ResourceAttrs["kind"] | "all";
	normalizedQuery: string;
	onMatchChange: (nodeId: string, matches: boolean) => void;
}) => {
	const attrs = useAttrs(["kind", "name", "mime"]) as Pick<
		ResourceRenderAttrs,
		"kind" | "name" | "mime"
	>;
	const kind = attrs.kind;
	const name = String(attrs.name ?? "");
	const mime = String(attrs.mime ?? "");
	const matchesKind = kindFilter === "all" || kind === kindFilter;
	const matchesQuery =
		normalizedQuery.length === 0 ||
		name.toLowerCase().includes(normalizedQuery) ||
		mime.toLowerCase().includes(normalizedQuery);
	const matches = matchesKind && matchesQuery;

	useEffect(() => {
		onMatchChange(resourceScope._nodeId, matches);
		return () => onMatchChange(resourceScope._nodeId, false);
	}, [matches, onMatchChange, resourceScope._nodeId]);

	if (!matches) {
		return null;
	}

	return (
		<ResourceRow
			resourceScope={resourceScope}
			onAddToTimeline={onAddToTimeline}
		/>
	);
};

const TextTimelineActionRow = () => {
	const { actions } = useVideoEditor();

	return (
		<li className="ve-resource-row ve-resource-row--text-action">
			<div
				className="ve-resource-thumb ve-resource-thumb--text-action"
				aria-hidden="true"
			>
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
	);
};

const ProjectMediaList = ({
	kindFilter,
	normalizedQuery,
	viewMode,
}: {
	kindFilter: ResourceAttrs["kind"] | "all";
	normalizedQuery: string;
	viewMode: "list" | "grid";
}) => {
	const projectDispatch = useActions();
	const resourceScopes = useMany("resources");
	const [matchingResourceIds, setMatchingResourceIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const handleAddToTimeline = useCallback(
		(resourceId: string) => {
			projectDispatch("addResourceToTimeline", resourceId);
		},
		[projectDispatch],
	);
	const handleMatchChange = useCallback((nodeId: string, matches: boolean) => {
		setMatchingResourceIds((current) => {
			const next = new Set(current);
			if (matches) {
				next.add(nodeId);
			} else {
				next.delete(nodeId);
			}
			return next.size === current.size &&
				[...next].every((id) => current.has(id))
				? current
				: next;
		});
	}, []);

	return (
		<>
			<div className="ve-media-count">
				{matchingResourceIds.size} of {resourceScopes.length} assets
			</div>
			<div className="ve-media-bin__body">
				<ul className={`ve-resource-list ve-resource-list--${viewMode}`}>
					<TextTimelineActionRow />
					{resourceScopes.map((resourceScope) => (
						<ScopeContext.Provider
							key={resourceScope._nodeId}
							value={resourceScope}
						>
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
				{resourceScopes.length === 0 ? (
					<p className="ve-empty">
						Import video, image, or audio files to populate the bin.
					</p>
				) : null}
				{resourceScopes.length > 0 && matchingResourceIds.size === 0 ? (
					<p className="ve-empty">No assets match the current filters.</p>
				) : null}
			</div>
		</>
	);
};

const useProjectImportFiles = () => {
	const { actions } = useVideoEditor();
	const projectScope = useScope();
	return useCallback(
		(files: FileList | MediaImportEntry[]) => {
			if (projectScope) {
				actions.importFilesIntoProject(files, projectScope);
			}
		},
		[actions, projectScope],
	);
};

const MediaBinPanel = ({
	children,
	importFiles,
	kindFilter,
	query,
	setKindFilter,
	setQuery,
	setViewMode,
	viewMode,
}: {
	children: React.ReactNode;
	importFiles?: (files: FileList | MediaImportEntry[]) => void;
	kindFilter: ResourceAttrs["kind"] | "all";
	query: string;
	setKindFilter: (value: ResourceAttrs["kind"] | "all") => void;
	setQuery: (value: string) => void;
	setViewMode: (value: "list" | "grid") => void;
	viewMode: "list" | "grid";
}) => {
	return (
		<section className="ve-panel ve-media-bin" aria-label="Media bin">
			<div className="ve-panel__header">
				<h2>Media bin</h2>
				{importFiles ? (
					<label
						className="ve-import-button"
						onClick={async (event) => {
							const picker = (window as Window & {
								showOpenFilePicker?: (options?: {
									multiple?: boolean;
									types?: Array<{ description?: string; accept: Record<string, string[]> }>;
								}) => Promise<FileSystemFileHandle[]>;
							}).showOpenFilePicker;
							if (typeof picker !== "function") {
								return;
							}
							event.preventDefault();
							const handles = await picker({
								multiple: true,
								types: [
									{
										description: "Media",
										accept: {
											"video/*": [".mp4", ".webm", ".mov", ".mkv"],
											"image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
											"audio/*": [".wav", ".mp3", ".ogg", ".m4a", ".aac"],
										},
									},
								],
							}).catch(() => []);
							const entries = await Promise.all(
								handles.map(async (handle) => ({
									handle,
									file: await handle.getFile(),
								})),
							);
							if (entries.length > 0) {
								importFiles(entries);
							}
						}}
					>
						<Upload size={14} aria-hidden="true" />
						<span>Import</span>
						<input
							type="file"
							aria-label="Import media files"
							accept="video/*,image/*,audio/*"
							multiple
							onChange={(event) => {
								if (event.currentTarget.files) {
									importFiles(event.currentTarget.files);
									event.currentTarget.value = "";
								}
							}}
						/>
					</label>
				) : (
					<button className="ve-import-button" type="button" disabled>
						<Upload size={14} aria-hidden="true" />
						<span>Import</span>
					</button>
				)}
			</div>
			<section className="ve-media-controls" aria-label="Media filters">
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
					onChange={(event) =>
						setKindFilter(
							event.currentTarget.value as ResourceAttrs["kind"] | "all",
						)
					}
				>
					<option value="all">All media</option>
					<option value="video">Video</option>
					<option value="image">Images</option>
					<option value="audio">Audio</option>
				</select>
				<div className="ve-segmented-control">
					<IconButton
						type="button"
						icon={List}
						label="List view"
						variant={viewMode === "list" ? "secondary" : "ghost"}
						aria-pressed={viewMode === "list"}
						onClick={() => setViewMode("list")}
					/>
					<IconButton
						type="button"
						icon={Grid2X2}
						label="Grid view"
						variant={viewMode === "grid" ? "secondary" : "ghost"}
						aria-pressed={viewMode === "grid"}
						onClick={() => setViewMode("grid")}
					/>
				</div>
			</section>
			{children}
		</section>
	);
};

type MediaBinViewState = {
	kindFilter: ResourceAttrs["kind"] | "all";
	normalizedQuery: string;
	query: string;
	setKindFilter: (value: ResourceAttrs["kind"] | "all") => void;
	setQuery: (value: string) => void;
	setViewMode: (value: "list" | "grid") => void;
	viewMode: "list" | "grid";
};

const MediaBinEmptyState = (
	props: Omit<MediaBinViewState, "normalizedQuery">,
) => {
	const { actions } = useVideoEditor();

	return (
		<MediaBinPanel {...props}>
			<div className="ve-media-count">0 of 0 assets</div>
			<div className="ve-media-bin__body">
				<div className="ve-empty-state">
					<p className="ve-empty">No active project.</p>
					<button type="button" onClick={() => actions.createProject()}>
						New project
					</button>
				</div>
			</div>
		</MediaBinPanel>
	);
};

const MediaBinProject = (props: MediaBinViewState) => {
	const importFiles = useProjectImportFiles();

	return (
		<MediaBinPanel {...props} importFiles={importFiles}>
			<ProjectMediaList
				kindFilter={props.kindFilter}
				normalizedQuery={props.normalizedQuery}
				viewMode={props.viewMode}
			/>
		</MediaBinPanel>
	);
};

export const MediaBin = () => {
	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState<ResourceAttrs["kind"] | "all">(
		"all",
	);
	const [viewMode, setViewMode] = useState<"list" | "grid">("list");
	const normalizedQuery = query.trim().toLowerCase();
	const viewState = {
		kindFilter,
		normalizedQuery,
		query,
		setKindFilter,
		setQuery,
		setViewMode,
		viewMode,
	};

	return (
		<One rel="activeProject" fallback={<MediaBinEmptyState {...viewState} />}>
			<MediaBinProject {...viewState} />
		</One>
	);
};
