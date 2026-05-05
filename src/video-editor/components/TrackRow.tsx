import { Eye, Lock, Volume2 } from 'lucide-react'
import {
	EditorScopeProvider,
	useEditorAttrs,
	useEditorComp,
	useEditorMany,
} from '../render-sync'
import type { EditorScope } from '../render-sync/EditorScope'
import { IconButton } from './ControlPrimitives'
import { ClipItem } from './ClipItem'

interface TrackRowProps {
	trackScope: EditorScope
	timelineZoom: number
	activeTool: 'select' | 'trim' | 'split' | 'hand'
}

interface TrackRenderAttrs {
	name?: unknown
	kind?: unknown
	muted?: unknown
	locked?: unknown
}

export const TrackLabel = ({ trackScope }: { trackScope: EditorScope }) => {
	const trackAttrs = useEditorAttrs<TrackRenderAttrs>(['name', 'kind', 'muted', 'locked'], trackScope)
	const trackName = String(trackAttrs.name)
	const trackKind = String(trackAttrs.kind)
	const isMuted = Boolean(trackAttrs.muted)
	const isLocked = Boolean(trackAttrs.locked)

	return (
		<div className="ve-track-row__label">
			<div>
				<strong>{trackName}</strong>
				<small>{trackKind}</small>
			</div>
			<div
				className="ve-track-row__controls"
				aria-label={`${trackName} controls`}
			>
				<IconButton
					type="button"
					icon={Volume2}
					label={isMuted ? 'Track muted' : 'Track audible'}
					variant={isMuted ? 'secondary' : 'ghost'}
					disabled
				/>
				<IconButton
					type="button"
					icon={Lock}
					label={isLocked ? 'Track locked' : 'Track unlocked'}
					variant={isLocked ? 'secondary' : 'ghost'}
					disabled
				/>
				<IconButton
					type="button"
					icon={Eye}
					label="Track visible"
					variant="ghost"
					disabled
				/>
			</div>
		</div>
	)
}

export const TrackLane = ({ trackScope, timelineZoom, activeTool }: TrackRowProps) => {
	const clipScopes = useEditorMany('clips', trackScope)
	const trackEnd = useEditorComp<number>('trackEnd', trackScope)
	const trackWidth = Math.max(960, Math.ceil((trackEnd + 2) * timelineZoom))

	return (
		<div className="ve-track-row__rail">
			{clipScopes.length === 0 ? (
				<p className="ve-empty">Drop clips here.</p>
			) : (
				<div
					className="ve-track-row__timeline"
					style={{ width: `${trackWidth}px` }}
				>
					{clipScopes.map((clipScope) => (
						<EditorScopeProvider key={clipScope.nodeId} scope={clipScope}>
							<ClipItem
								clipScope={clipScope}
								timelineZoom={timelineZoom}
								activeTool={activeTool}
							/>
						</EditorScopeProvider>
					))}
				</div>
			)}
		</div>
	)
}
