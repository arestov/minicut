import { Eye, Lock, Volume2 } from 'lucide-react'
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import { useManyWithAttrs } from '../../dkt-react-sync/hooks/useManyWithAttrs'
import { IconButton } from './ControlPrimitives'
import { ClipItem } from './ClipItem'

interface TrackRowProps {
	timelineZoom: number
	activeTool: 'select' | 'trim' | 'split' | 'hand'
	selectedEntityId: string | null
}

interface TrackRenderAttrs {
	name?: unknown
	kind?: unknown
	muted?: unknown
	locked?: unknown
}

export const TrackLabel = () => {
	const trackAttrs = useAttrs(['name', 'kind', 'muted', 'locked']) as TrackRenderAttrs
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
			<div className="ve-track-row__controls" aria-label={`${trackName} controls`}>
				<IconButton type="button" icon={Volume2} label={isMuted ? 'Track muted' : 'Track audible'} variant={isMuted ? 'secondary' : 'ghost'} disabled />
				<IconButton type="button" icon={Lock} label={isLocked ? 'Track locked' : 'Track unlocked'} variant={isLocked ? 'secondary' : 'ghost'} disabled />
				<IconButton type="button" icon={Eye} label="Track visible" variant="ghost" disabled />
			</div>
		</div>
	)
}

export const TrackLane = ({ timelineZoom, activeTool, selectedEntityId }: TrackRowProps) => {
	const clipItems = useManyWithAttrs('clips', ['start', 'duration'])
	const trackEnd = clipItems.reduce((maxEnd, { attrs }) => {
		const start = Number(attrs.start ?? 0)
		const duration = Number(attrs.duration ?? 0)
		return Math.max(maxEnd, start + duration)
	}, 0)
	const trackWidth = Math.max(960, Math.ceil((trackEnd + 2) * timelineZoom))

	return (
		<div className="ve-track-row__rail">
			{clipItems.length === 0 ? (
				<p className="ve-empty">Drop clips here.</p>
			) : (
				<div className="ve-track-row__timeline" style={{ width: `${trackWidth}px` }}>
					{clipItems.map(({ scope: clipScope }) => (
						<ScopeContext.Provider key={clipScope._nodeId} value={clipScope}>
							<ClipItem timelineZoom={timelineZoom} activeTool={activeTool} selectedEntityId={selectedEntityId} />
						</ScopeContext.Provider>
					))}
				</div>
			)}
		</div>
	)
}
