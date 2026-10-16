import { Match, Show, Switch } from "solid-js";
import { createAttrsFor, ReadyGate, ScopeContext, useAttrs, useOne, useRootDispatch, useScopeRuntime } from "../../../dkt-solid-sync";
import { inspectorTabs, type InspectorTab } from "../../../video-editor/components/inspector/types";
import { Panel } from "../controls/Panel";
import { Tabs } from "../controls/Tabs";
import { colors, metrics } from "../theme";
import { InspectorClipHeader, type InspectorTrackPosition } from "./InspectorClipHeader";

import { InspectorEditTabPanel } from "./InspectorEditTabPanel";
import { InspectorAudioTabPanel } from "./InspectorAudioTabPanel";

import { InspectorColorTabPanel } from "./InspectorColorTabPanel";

const options = inspectorTabs.map(({ id, label }) => ({ value: id, label }));
const Empty = () => <div style={{ padding: 12 }}><text testId="inspector-empty" style={{ color: colors.textMuted, fontSize: 12 }}>No clip selected</text></div>;

/** Session-owned navigation, with editors keyed by the selected Clip identity. */
export const Inspector = () => {
 const selected = useOne("selectedClip");
 const attrs = useAttrs(["activeInspectorTab", "selectedClipTrackPosition", "exportProgress"]);
 const selectedAttrs = createAttrsFor(useScopeRuntime(), selected, ["name"]);
 const dispatch = useRootDispatch();
 const ready = () => selected() !== null && selectedAttrs.name() != null;
 const activeTab = (): InspectorTab => options.find(option => option.value === attrs.activeInspectorTab())?.value ?? "edit";
 return <Panel title="Inspector" testId="inspector" width={metrics.inspectorWidth}>
  <Tabs options={options} value={activeTab()} label="Inspector tabs" testId="inspector-tabs" disabled={!ready()} onChange={tab => { if (ready()) dispatch("setActiveInspectorTab", tab); }} />
  <Show when={selected()} keyed fallback={<Empty />}>{scope =>
   <ScopeContext.Provider value={() => scope}>
    <ReadyGate attrName="name" fallback={<Empty />}>
     <InspectorClipHeader trackPosition={attrs.selectedClipTrackPosition() as InspectorTrackPosition | null} isCurrentOwner={() => ready() && selected()?._nodeId === scope._nodeId} />
     <div role="tabpanel" aria-label={`${options.find(option => option.value === activeTab())!.label} inspector`} testId={`inspector-panel-${activeTab()}`} style={{ padding: 10, display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
      <Switch fallback={<text>{options.find(option => option.value === activeTab())!.label}</text>}>
       <Match when={activeTab() === "edit"}><InspectorEditTabPanel isCurrentOwner={() => ready() && selected()?._nodeId === scope._nodeId} /></Match>
       <Match when={activeTab() === "color"}><InspectorColorTabPanel isCurrentOwner={() => ready() && selected()?._nodeId === scope._nodeId} /></Match>
       <Match when={activeTab() === "audio"}><InspectorAudioTabPanel isCurrentOwner={() => ready() && selected()?._nodeId === scope._nodeId} /></Match>
      </Switch>
     </div>
    </ReadyGate>
   </ScopeContext.Provider>
  }</Show>
 </Panel>;
};
