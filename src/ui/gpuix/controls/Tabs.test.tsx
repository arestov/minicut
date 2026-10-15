import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { Tabs } from "./Tabs";
const options = [{value:"edit",label:"Edit"},{value:"color",label:"Color"},{value:"audio",label:"Audio"},{value:"export",label:"Export"}] as const;
describe("Tabs", () => {
 test("controlled activation, native focus, order and external roving selection", () => {
  const root = createTestRoot(); const [value,setValue] = createSignal("edit"); const chosen: string[] = [];
  root.render(() => <div style={{display:"flex",width:500,height:100}}><Tabs options={options} value={value()} label="Inspector" testId="tabs" onChange={(n) => {chosen.push(n);setValue(n);}} /></div>);
  const el = (key: string) => root.renderer.findByTestId("tabs-"+key)!;
  const positions = options.map(o => root.renderer.getElementBounds(el(o.value).id)!.x);
  expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  for (const o of options) expect(el(o.value).customProps?.role).toBe("tab");
  for (const [from,key,to] of [["edit","left","export"],["export","right","edit"],["edit","end","export"],["export","home","edit"],["edit","right","color"],["audio","enter","audio"],["export","space","export"]]) {
   root.renderer.nativeSimulateKeystrokes(el(from).id,key);
   expect(value()).toBe(to); expect(root.renderer.getFocusedElementId()).toBe(el(to).id);
   expect(el(to).customProps?.["aria-selected"]).toBe(true);
  }
  const b = root.renderer.getElementBounds(el("color").id)!;
  root.renderer.nativeSimulateClick(b.x+b.width/2,b.y+b.height/2); expect(value()).toBe("color");
  const focus = root.renderer.getFocusedElementId(); const count = chosen.length;
  setValue("audio"); root.flushSync(()=>{});
  expect(root.renderer.getFocusedElementId()).toBe(focus); expect(chosen.length).toBe(count);
  for(const o of options) expect(el(o.value).customProps?.tabIndex).toBe(o.value==="audio"?0:-1);
  root.unmount();
 });
 test("does not choose locally before caller echo and ignores disabled activation", () => {
  const root=createTestRoot(); const [disabled,setDisabled]=createSignal(false); const chosen:string[]=[];
  root.render(()=><div style={{display:"flex",width:500,height:100}}><Tabs options={options} value="edit" disabled={disabled()} label="Inspector" testId="t" onChange={n=>chosen.push(n)}/></div>);
  const el=()=>root.renderer.findByTestId("t-color")!;
  root.renderer.nativeSimulateKeystrokes(el().id,"enter"); expect(chosen).toEqual(["color"]); expect(el().customProps?.["aria-selected"]).toBe(false);
  setDisabled(true);root.flushSync(()=>{});root.renderer.nativeSimulateKeystrokes(el().id,"space right home end");
  expect(chosen).toEqual(["color"]);expect(el().customProps?.tabIndex).toBe(-1);root.unmount();
 });
});
