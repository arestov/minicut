import { fireEvent, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ScopeContext } from "../../../dkt-react-sync/context/ScopeContext";
import { ReactScopeRuntimeContext } from "../../../dkt-react-sync/context/ReactScopeRuntimeContext";
import type { ReactScopeRuntime } from "../../../dkt-ui-sync/runtime/ReactScopeRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";

const state = vi.hoisted(() => ({exists: undefined as boolean | undefined, children: [] as {_nodeId:string}[]}));
vi.mock("../../../dkt-react-sync/hooks/useMany", () => ({useMany: (rel: string) => {
 expect(rel).toBe("colorCorrectionEffects"); return state.children;
}}));
vi.mock("../../../dkt-react-sync/hooks/useAttrs", () => ({useAttrs: () => {
 const scope = useContext(ScopeContext);
 return scope?._nodeId === "clip" ? {color:"#2563eb", $meta$rels$colorCorrectionEffects$exists:state.exists} : {enabled:false,params:{lookId:"cinema",exposure:{value:.1},unknown:{keep:scope?._nodeId}}};
}}));
vi.mock("../lookThumbnailWorker?worker", () => ({default: class {}}));
import { InspectorColorTabPanel } from "./InspectorColorTabPanel";

afterEach(cleanup);
const mount = () => {
 const calls: {scope:string|null; action:string; payload:unknown}[] = [];
 const runtime = {getDispatch: (scope: ReactSyncScopeHandle|null) => (action:string,payload:unknown) => calls.push({scope:scope?._nodeId??null, action,payload})};
 const ui = () => <ReactScopeRuntimeContext.Provider value={runtime as unknown as ReactScopeRuntime}><ScopeContext.Provider value={{_nodeId:"clip"} as ReactSyncScopeHandle}><InspectorColorTabPanel /></ScopeContext.Provider></ReactScopeRuntimeContext.Provider>;
 return {...render(ui()),calls,ui};
};
describe("Web Color model projection wiring", () => {
 it("gates Add only on loaded model absence", () => {
  state.children=[]; state.exists=undefined;
  const view=mount();
  expect(screen.queryByText("Add primary correction")).toBeNull();
  state.exists=false; view.rerender(view.ui());
  fireEvent.click(screen.getByText("Add primary correction"));
  expect(view.calls).toEqual([{scope:"clip",action:"addEffect",payload:{kind:"color-correction",name:"Color correction"}}]);
  state.exists=true; view.rerender(view.ui());
  expect(screen.queryByText("Add primary correction")).toBeNull();
 });
 it("renders all projected scopes and sends scalar deltas only to their owner", () => {
  state.children=[{_nodeId:"a"},{_nodeId:"b"}]; state.exists=true;
  const view=mount();
  const inputs=screen.getAllByLabelText("Exposure");
  expect(inputs).toHaveLength(2);
  expect(screen.getAllByText("Enable grade")).toHaveLength(2);
  fireEvent.change(inputs[1],{target:{value:"25"}});
  expect(view.calls).toEqual([{scope:"b",action:"patchEffectParams",payload:{params:{exposure:{value:.25},lookId:"custom"}}}]);
  fireEvent.click(screen.getAllByText("Reset grade")[0]);
  expect(view.calls[1].scope).toBe("a");
  expect(view.calls[1].action).toBe("patchEffectParams");
  expect((view.calls[1].payload as {params:object}).params).not.toHaveProperty("unknown");
  fireEvent.click(screen.getAllByText("Warm", {selector:"button"})[0]);
  expect(view.calls[2]).toMatchObject({scope:"a",action:"patchEffectParams",payload:{params:{lookId:"custom",lookIntensity:{value:1}}}});
  expect((view.calls[2].payload as {params:object}).params).not.toHaveProperty("unknown");
  fireEvent.click(screen.getAllByLabelText("Apply look Cinema")[1]);
  expect(view.calls[3]).toEqual({scope:"b",action:"patchEffectParams",payload:{params:{lookId:"cinema",lookIntensity:{value:1},exposure:{value:-.04},contrast:{value:1.18},saturation:{value:.94},temperature:{value:0},hue:{value:-4},gamma:{value:.98}}}});
  fireEvent.change(screen.getAllByLabelText("Look intensity")[1], {target:{value:"35"}});
  expect(view.calls[4]).toMatchObject({scope:"b",action:"patchEffectParams",payload:{params:{lookId:"cinema",lookIntensity:{value:.35},hue:{value:-1.4}}}});
  expect((view.calls[4].payload as {params:object}).params).not.toHaveProperty("unknown");

 });
});
