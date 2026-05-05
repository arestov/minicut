import { Volume2 } from 'lucide-react'
import { ScopeContext } from '../../../dkt-react-sync/context/ScopeContext'
import { useAttrs } from '../../../dkt-react-sync/hooks/useAttrs'
import { useOne } from '../../../dkt-react-sync/hooks/useOne'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { InspectorSection } from './InspectorSection'
import type { ClipRenderAttrs, ResourceRenderAttrs } from './types'

const InspectorAudioControls = ({ attrs, resourceKind, sourceClipId }: { attrs: ClipRenderAttrs; resourceKind: unknown; sourceClipId: string | null }) => {
	const { actions } = useVideoEditor()
	const selectedMediaKind = attrs.mediaKind ?? resourceKind
	const isAudioClip = selectedMediaKind === 'audio'
	const audio = attrs.audio

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Audio inspector">
			<InspectorSection title="Clip audio" icon={Volume2}>
				<label className="ve-slider-field">
					<span>Gain</span>
					<input type="range" aria-label="Gain" min="0" max="150" value={Math.round((audio?.gain ?? 1) * 100)} disabled={!isAudioClip || !sourceClipId} onChange={(event) => sourceClipId ? actions.updateClipAudioById(sourceClipId, { gain: Number(event.currentTarget.value) / 100 }) : undefined} />
				</label>
				<p className="ve-preview__summary">{isAudioClip ? `Gain ${Math.round((audio?.gain ?? 1) * 100)}%` : 'Select an audio clip to edit playback settings.'}</p>
			</InspectorSection>
		</div>
	)
}

const InspectorAudioControlsWithResource = ({ attrs, sourceClipId }: { attrs: ClipRenderAttrs; sourceClipId: string | null }) => {
	const resourceAttrs = useAttrs(['kind']) as ResourceRenderAttrs

	return <InspectorAudioControls attrs={attrs} resourceKind={resourceAttrs.kind ?? 'image'} sourceClipId={sourceClipId} />
}

export const InspectorAudioTabPanel = () => {
	const attrs = useAttrs(['sourceClipId', 'audio', 'mediaKind']) as ClipRenderAttrs & { sourceClipId?: unknown }
	const resourceScope = useOne('resource')
	const sourceClipId = typeof attrs.sourceClipId === 'string' ? attrs.sourceClipId : null

	if (!resourceScope) {
		return <InspectorAudioControls attrs={attrs} resourceKind="image" sourceClipId={sourceClipId} />
	}

	return (
		<ScopeContext.Provider value={resourceScope}>
			<InspectorAudioControlsWithResource attrs={attrs} sourceClipId={sourceClipId} />
		</ScopeContext.Provider>
	)
}
