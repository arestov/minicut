import { EditorScopeProvider, ROOT_SCOPE, SESSION_SCOPE, useEditorActions, useEditorAttrs } from '../render-sync'
import { useSelectedEntityScope } from '../ui/dkt/hooks'
import type { PreviewMediaElementRegistry } from './mediaElementRegistry'
import { InspectorAudioTabPanel } from './inspector/InspectorAudioTabPanel'
import { InspectorClipHeader } from './inspector/InspectorClipHeader'
import { InspectorColorTabPanel } from './inspector/InspectorColorTabPanel'
import { InspectorEditTabPanel } from './inspector/InspectorEditTabPanel'
import { InspectorExportTabPanel } from './inspector/InspectorExportTabPanel'
import { InspectorTabs } from './inspector/InspectorTabs'
import type { InspectorTab } from './inspector/types'

export const Inspector = ({ mediaElementRegistry }: { mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const sessionDispatch = useEditorActions(SESSION_SCOPE)
	const rootAttrs = useEditorAttrs<{ activeProjectId?: unknown }>(['activeProjectId'], ROOT_SCOPE)
	const sessionAttrs = useEditorAttrs<{ activeInspectorTab?: InspectorTab }>(['activeInspectorTab'], SESSION_SCOPE)
	const selectedEntityScope = useSelectedEntityScope()
	const activeTab = sessionAttrs.activeInspectorTab ?? 'edit'
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
	const isClip = activeProjectId && selectedEntityScope?.type === 'clip'
	const setActiveTab = (tab: InspectorTab): void => sessionDispatch('setActiveInspectorTab', { tab })

	if (!selectedEntityScope || !isClip) {
		return (
			<aside className="ve-panel" aria-label="Inspector">
				<div className="ve-panel__header"><h2>Inspector</h2></div>
				<InspectorTabs activeTab={activeTab} onChange={setActiveTab} disabled />
				<p className="ve-empty">Select a clip to edit opacity or split it.</p>
			</aside>
		)
	}

	return (
		<EditorScopeProvider scope={selectedEntityScope}>
			<aside className="ve-panel" aria-label="Inspector">
				<div className="ve-panel__header"><h2>Inspector</h2><span className="ve-inspector-status">clip selected</span></div>
				<InspectorTabs activeTab={activeTab} onChange={setActiveTab} />
				<InspectorClipHeader clipScope={selectedEntityScope} />
				{activeTab === 'edit' ? <InspectorEditTabPanel clipScope={selectedEntityScope} mediaElementRegistry={mediaElementRegistry} /> : null}
				{activeTab === 'color' ? <InspectorColorTabPanel clipScope={selectedEntityScope} mediaElementRegistry={mediaElementRegistry} /> : null}
				{activeTab === 'audio' ? <InspectorAudioTabPanel clipScope={selectedEntityScope} /> : null}
				{activeTab === 'export' ? <InspectorExportTabPanel clipScope={selectedEntityScope} /> : null}
			</aside>
		</EditorScopeProvider>
	)
}
