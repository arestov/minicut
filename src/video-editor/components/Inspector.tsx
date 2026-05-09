import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useRootAttrs } from '../../dkt-react-sync/hooks/useRootAttrs'
import { useRootDispatch } from '../../dkt-react-sync/hooks/useRootDispatch'
import { useRootOne } from '../../dkt-react-sync/hooks/useRootOne'
import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import type { PreviewMediaElementRegistry } from './mediaElementRegistry'
import { InspectorAudioTabPanel } from './inspector/InspectorAudioTabPanel'
import { InspectorClipHeader } from './inspector/InspectorClipHeader'
import { InspectorColorTabPanel } from './inspector/InspectorColorTabPanel'
import { InspectorEditTabPanel } from './inspector/InspectorEditTabPanel'
import { InspectorExportTabPanel } from './inspector/InspectorExportTabPanel'
import { InspectorTabs } from './inspector/InspectorTabs'
import type { InspectorTab } from './inspector/types'

interface SelectedClipTrackPosition {
	trackName: string
	ordinal: number
}

const EmptyInspector = ({ activeTab, onChange, disabled = true }: { activeTab: InspectorTab; onChange: (tab: InspectorTab) => void; disabled?: boolean }) => (
	<aside className="ve-panel" aria-label="Inspector">
		<div className="ve-panel__header"><h2>Inspector</h2></div>
		<InspectorTabs activeTab={activeTab} onChange={onChange} disabled={disabled} />
		<p className="ve-empty">Select a clip to edit opacity or split it.</p>
	</aside>
)

const SelectedClipPanels = ({ activeTab, mediaElementRegistry, onChangeTab, trackPosition }: { activeTab: InspectorTab; mediaElementRegistry?: PreviewMediaElementRegistry; onChangeTab: (tab: InspectorTab) => void; trackPosition: SelectedClipTrackPosition | null }) => (
	<aside className="ve-panel" aria-label="Inspector">
		<div className="ve-panel__header"><h2>Inspector</h2><span className="ve-inspector-status">clip selected</span></div>
		<InspectorTabs activeTab={activeTab} onChange={onChangeTab} />
		<InspectorClipHeader trackPosition={trackPosition} />
		{activeTab === 'edit' ? <InspectorEditTabPanel mediaElementRegistry={mediaElementRegistry} /> : null}
		{activeTab === 'color' ? <InspectorColorTabPanel mediaElementRegistry={mediaElementRegistry} /> : null}
		{activeTab === 'audio' ? <InspectorAudioTabPanel /> : null}
		{activeTab === 'export' ? <InspectorExportTabPanel /> : null}
	</aside>
)

export const Inspector = ({ mediaElementRegistry }: { mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const sessionDispatch = useRootDispatch()
	const runtime = useReactScopeRuntime()
	const rootAttrs = useRootAttrs(['activeProjectId', 'activeInspectorTab', 'selectedEntityId', 'selectedClipTrackPosition']) as { activeProjectId?: unknown; activeInspectorTab?: InspectorTab; selectedEntityId?: unknown; selectedClipTrackPosition?: SelectedClipTrackPosition | null }
	const trackPosition = rootAttrs.selectedClipTrackPosition ?? null
	const activeTab = rootAttrs.activeInspectorTab ?? 'edit'
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
	const selectedEntityId = typeof rootAttrs.selectedEntityId === 'string' ? rootAttrs.selectedEntityId : null
	const setActiveTab = (tab: InspectorTab): void => sessionDispatch('setActiveInspectorTab', tab)

	// Read selectedClip rel from session scope (single source of truth)
	const selectedClipScope = useRootOne('selectedClip')

	if (!activeProjectId || !selectedClipScope) {
		return <EmptyInspector activeTab={activeTab} onChange={setActiveTab} />
	}

	return (
		<ScopeContext.Provider value={selectedClipScope}>
			<SelectedClipPanels activeTab={activeTab} mediaElementRegistry={mediaElementRegistry} onChangeTab={setActiveTab} trackPosition={trackPosition} />
		</ScopeContext.Provider>
	)
}
