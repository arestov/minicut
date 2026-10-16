import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { InspectorTransformField } from "./InspectorTransformField";
const mount = () => {
 const root = createTestRoot();
 const [value, setValue] = createSignal(1);
 const [owner, setOwner] = createSignal("a");
 const [current, setCurrent] = createSignal(true);
 const [disabled, setDisabled] = createSignal(false);
 const changes: number[] = [];
 root.render(() => <div style={{ display: "flex", width: 400, height: 300 }}><InspectorTransformField value={value()} ownerId={owner()} isCurrentOwner={current} disabled={disabled()} label="Scale" testId="number" onChange={n => { changes.push(n); setValue(n); }} /><div testId="other" tabIndex={0}>Other</div></div>);
 const input = () => root.renderer.findByTestId("number")!;
 const replace = (text: string) => {
  const old = String(input().customProps?.value ?? "");
  root.renderer.nativeSimulateKeystrokes(input().id, "backspace ".repeat(old.length));
  if (text) root.renderer.nativeSimulateKeystrokes(input().id, text.split("").map(c => c === " " ? "space" : c).join(" "));
 };
 const blur = () => root.renderer.focusElement(root.renderer.findByTestId("other")!.id);
 return { root, value, setValue, setOwner, setCurrent, setDisabled, changes, input, replace, blur, flush: () => root.flushSync(() => {}) };
};
test("finite zero and negative values emit immediately, with no submit or blur duplicate", () => {
 const v = mount();
 for (const text of ["0", "-2", "3.5"]) {
  v.replace(text);
  expect(v.value()).toBe(Number(text));
  const count = v.changes.length;
  v.root.renderer.nativeSimulateKeystrokes(v.input().id, "enter");
  v.blur();
  expect(v.changes.length).toBe(count);
 }
 expect(v.root.renderer.getAllText()).toContain("Increment 0.1");
 v.root.unmount();
});
test("empty partial and nonfinite drafts stay local and reset on Enter blur and Escape", () => {
 const v = mount();
 for (const text of ["", " ", "-", "NaN", "Infinity", "-Infinity"]) {
  const count = v.changes.length;
  v.replace(text);
  expect(v.input().customProps?.value).toBe(text);
  expect(v.changes.length).toBe(count);
  expect(v.root.renderer.getAllText()).toContain("Enter a finite number");
  v.root.renderer.nativeSimulateKeystrokes(v.input().id, "enter");
  expect(v.input().customProps?.value).toBe(String(v.value()));
 }
 v.replace("1e");
 expect(v.input().customProps?.value).toBe("1e");
 const count = v.changes.length;
 v.blur();
 expect(v.input().customProps?.value).toBe("1");
 expect(v.changes.length).toBe(count);
 v.replace("-");
 v.root.renderer.nativeSimulateKeystrokes(v.input().id, "escape");
 expect(v.input().customProps?.value).toBe("1");
 v.root.unmount();
});
test("external value owner and availability changes discard text and disabled edits emit nothing", () => {
 const v = mount();
 v.replace("-"); v.setValue(7); v.flush();
 expect(v.input().customProps?.value).toBe("7");
 v.replace("-"); v.setOwner("b"); v.flush();
 expect(v.input().customProps?.value).toBe("7");
 v.replace("-"); v.setCurrent(false); v.flush();
 expect(v.input().customProps?.value).toBe("7");
 v.replace("9"); expect(v.changes).toEqual([]);
 v.setCurrent(true); v.setDisabled(true); v.flush();
 v.replace("9"); expect(v.changes).toEqual([]);
 expect(v.input().customProps?.readOnly).toBe(true);
 v.root.unmount();
 expect(v.changes).toEqual([]);
});
