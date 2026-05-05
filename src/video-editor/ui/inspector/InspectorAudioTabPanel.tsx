import { Volume2 } from 'lucide-react'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { ROOT_SCOPE, useEditorAttrs, useEditorOne } from '../../render-sync'
import type { EditorScope } from '../../render-sync/EditorScope'
import { InspectorSection } from './InspectorSection'
import type { ClipRenderAttrs, ResourceRenderAttrs } from './types'

export const InspectorAudioTabPanel = ({ clipScope }: { clipScope: EditorScope }) => {
	const { actions } = useVideoEditor()
	const attrs = useEditorAttrs<ClipRenderAttrs>(['audio', 'mediaKind'], clipScope)
	const resourceScope = useEditorOne('resource', clipScope)
	const resourceAttrs = useEditorAttrs<ResourceRenderAttrs>(['kind'], resourceScope ?? ROOT_SCOPE)
	const resourceKind = resourceAttrs?.kind ?? 'image'
	const selectedMediaKind = attrs.mediaKind ?? resourceKind
	const isAudioClip = selectedMediaKind === 'audio'
	const audio = attrs.audio

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Audio inspector">
			<InspectorSection title="Clip audio" icon={Volume2}>
				<label className="ve-slider-field">
					<span>Gain</span>
					<input type="range" aria-label="Gain" min="0" max="150" value={Math.round((audio?.gain ?? 1) * 100)} disabled={!isAudioClip} onChange={(event) => actions.updateSelectedClipAudio({ gain: Number(event.currentTarget.value) / 100 })} />
				</label>
				<p className="ve-preview__summary">{isAudioClip ? `Gain ${Math.round((audio?.gain ?? 1) * 100)}%` : 'Select an audio clip to edit playback settings.'}</p>
			</InspectorSection>
		</div>
	)
}
