import { useSyncExternalStore } from "react";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { useMany } from "../../dkt-react-sync/hooks/useMany";
import { useReactScopeRuntime } from "../../dkt-react-sync/hooks/useReactScopeRuntime";
import { useRootAttrs } from "../../dkt-react-sync/hooks/useRootAttrs";
import { useRootDispatch } from "../../dkt-react-sync/hooks/useRootDispatch";
import { useRootOne } from "../../dkt-react-sync/hooks/useRootOne";
import { useScope } from "../../dkt-react-sync/hooks/useScope";
import { useShape } from "../../dkt-react-sync/hooks/useShape";
import { defineShape } from "../../dkt-react-sync/shape/defineShape";
import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";
import { InspectorAudioTabPanel } from "./inspector/InspectorAudioTabPanel";
import { InspectorClipHeader } from "./inspector/InspectorClipHeader";
import { InspectorColorTabPanel } from "./inspector/InspectorColorTabPanel";
import { InspectorEditTabPanel } from "./inspector/InspectorEditTabPanel";
import { InspectorExportTabPanel } from "./inspector/InspectorExportTabPanel";
import { InspectorTabs } from "./inspector/InspectorTabs";
import type { InspectorTab } from "./inspector/types";
import type { PreviewMediaElementRegistry } from "./mediaElementRegistry";

interface SelectedClipTrackPosition {
	trackName: string;
	ordinal: number;
}

const selectedClipFallbackShape = defineShape({
	many: {
		tracks: defineShape({
			rels: ["clips"],
		}),
	},
});

const useSelectedClipFromActiveProject = (
	selectedEntityId: string | null,
): ReactSyncScopeHandle | null => {
	const runtime = useReactScopeRuntime();
	useShape(selectedClipFallbackShape);
	const trackScopes = useMany("tracks");
	return useSyncExternalStore(
		(listener) => {
			const cleanups = trackScopes.map((trackScope) =>
				runtime.subscribeMany(trackScope, "clips", listener),
			);
			return () => {
				for (const cleanup of cleanups) cleanup();
			};
		},
		() => {
			if (!selectedEntityId) return null;
			for (const trackScope of trackScopes) {
				const clipScope = runtime
					.readMany(trackScope, "clips")
					.find((clip) => {
						const legacyNodeId = (clip as { _node_id?: unknown })._node_id;
						return (
							clip._nodeId === selectedEntityId ||
							legacyNodeId === selectedEntityId
						);
					});
				if (clipScope) return clipScope;
			}
			return null;
		},
		() => null,
	);
};

const EmptyInspector = ({
	activeTab,
	onChange,
	disabled = true,
}: {
	activeTab: InspectorTab;
	onChange: (tab: InspectorTab) => void;
	disabled?: boolean;
}) => (
	<aside className="ve-panel" aria-label="Inspector">
		<div className="ve-panel__header">
			<h2>Inspector</h2>
		</div>
		<InspectorTabs
			activeTab={activeTab}
			onChange={onChange}
			disabled={disabled}
		/>
		<p className="ve-empty">Select a clip to edit opacity or split it.</p>
	</aside>
);

const SelectedClipPanels = ({
	activeTab,
	mediaElementRegistry,
	onChangeTab,
	trackPosition,
}: {
	activeTab: InspectorTab;
	mediaElementRegistry?: PreviewMediaElementRegistry;
	onChangeTab: (tab: InspectorTab) => void;
	trackPosition: SelectedClipTrackPosition | null;
}) => (
	<aside className="ve-panel" aria-label="Inspector">
		<div className="ve-panel__header">
			<h2>Inspector</h2>
			<span className="ve-inspector-status">clip selected</span>
		</div>
		<InspectorTabs activeTab={activeTab} onChange={onChangeTab} />
		<InspectorClipHeader trackPosition={trackPosition} />
		{activeTab === "edit" ? (
			<InspectorEditTabPanel mediaElementRegistry={mediaElementRegistry} />
		) : null}
		{activeTab === "color" ? (
			<InspectorColorTabPanel mediaElementRegistry={mediaElementRegistry} />
		) : null}
		{activeTab === "audio" ? <InspectorAudioTabPanel /> : null}
		{activeTab === "export" ? <InspectorExportTabPanel /> : null}
	</aside>
);

export const Inspector = ({
	mediaElementRegistry,
}: {
	mediaElementRegistry?: PreviewMediaElementRegistry;
}) => {
	const sessionDispatch = useRootDispatch();
	const projectScope = useScope();
	const rootAttrs = useRootAttrs([
		"activeProjectId",
		"activeInspectorTab",
		"selectedEntityId",
		"selectedClipTrackPosition",
	]) as {
		activeProjectId?: unknown;
		activeInspectorTab?: InspectorTab;
		selectedEntityId?: unknown;
		selectedClipTrackPosition?: SelectedClipTrackPosition | null;
	};
	const trackPosition = rootAttrs.selectedClipTrackPosition ?? null;
	const activeTab = rootAttrs.activeInspectorTab ?? "edit";
	const selectedEntityId =
		typeof rootAttrs.selectedEntityId === "string"
			? rootAttrs.selectedEntityId
			: null;
	const activeProjectId =
		typeof rootAttrs.activeProjectId === "string"
			? rootAttrs.activeProjectId
			: null;
	const setActiveTab = (tab: InspectorTab): void =>
		sessionDispatch("setActiveInspectorTab", tab);

	// Read selectedClip rel from session scope (single source of truth)
	const selectedClipRelScope = useRootOne("selectedClip");
	const selectedClipFallbackScope =
		useSelectedClipFromActiveProject(selectedEntityId);
	const selectedClipScope = selectedClipRelScope ?? selectedClipFallbackScope;

	if ((!activeProjectId && !projectScope) || !selectedClipScope) {
		return <EmptyInspector activeTab={activeTab} onChange={setActiveTab} />;
	}

	return (
		<ScopeContext.Provider value={selectedClipScope}>
			<SelectedClipPanels
				activeTab={activeTab}
				mediaElementRegistry={mediaElementRegistry}
				onChangeTab={setActiveTab}
				trackPosition={trackPosition}
			/>
		</ScopeContext.Provider>
	);
};
