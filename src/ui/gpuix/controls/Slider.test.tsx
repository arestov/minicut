import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { Slider } from "./Slider";
const mount = (noBounds = false) => {
	const root = createTestRoot();
	if (noBounds)
		root.renderer.getElementBounds = () => null;
	const [value, setValue] = createSignal(50);
	const [owner, setOwner] = createSignal("a");
	const [disabled, setDisabled] = createSignal(false);
	const values: number[] = [];
	root.render(() => <div style={{ display: "flex", paddingLeft: 70, paddingTop: 40, width: 400, height: 150 }}>
  <Slider testId="s" label="Opacity" valueText={value() + "%"} value={value()} min={0} max={100} step={10} identityKey={owner()} disabled={disabled()} onChange={(n) => { values.push(n); setValue(n); }}/>
 <div testId="other" tabIndex={0} style={{ width: 20, height: 20 }}/></div>);
	const element = () => root.renderer.findByTestId("s")!;
	const bounds = () => root.renderer.getElementBounds(element().id)!;
	const point = (t: number) => { const b = bounds(); return { x: b.x + 5 + t * (b.width - 10), y: b.y + b.height / 2 }; };
	const click = (t: number, button = 0) => { const p = point(t); root.renderer.nativeSimulateClick(p.x, p.y, button); };
	const flush = () => root.flushSync(() => { });
	return { root, value, setValue, setOwner, setDisabled, values, element, bounds, point, click, flush };
};
describe("Slider", () => {
	test("uses window bounds, rounds steps, reaches endpoints and echoes canonical text", () => {
		const v = mount();
		expect(v.bounds().x).toBeGreaterThan(0);
		v.click(0.26);
		expect(v.value()).toBe(30);
		v.click(0);
		expect(v.value()).toBe(0);
		v.click(1);
		expect(v.value()).toBe(100);
		expect(v.element().customProps?.["aria-valuetext"]).toBe("100%");
		expect(v.element().customProps?.role).toBe("slider");
		v.root.unmount();
	});
	test("drag samples moves and ends on up, leave, blur, owner and disabled transitions", () => {
		const v = mount();
		const r = v.root.renderer;
		const down = () => { const p = v.point(0); r.nativeSimulateMouseDown(p.x, p.y); };
		const move = (t: number) => { const p = v.point(t); r.nativeSimulateMouseMove(p.x, p.y, 0); };
		down();
		move(0.5);
		move(1);
		expect(v.values).toEqual([0, 50, 100]);
		const p = v.point(1);
		r.nativeSimulateMouseUp(p.x, p.y);
		move(0.5);
		expect(v.value()).toBe(100);
		down();
		const b = v.bounds();
		r.nativeSimulateMouseMove(b.x + b.width + 20, b.y, 0);
		const count = v.values.length;
		move(0.5);
		expect(v.values.length).toBe(count);
		down();
		r.focusElement(v.root.renderer.findByTestId("other")!.id);
		move(1);
		expect(v.values.length).toBe(count);
		down();
		v.setOwner("b");
		v.flush();
		move(1);
		expect(v.values.length).toBe(count);
		down();
		v.setDisabled(true);
		v.flush();
		move(1);
		expect(v.values.length).toBe(count);
		v.root.unmount();
	});
	test("supports controlled keyboard, external updates and disabled guards", () => {
		const v = mount();
		const r = v.root.renderer;
		for (const [key, expected] of [["left", 40], ["down", 30], ["right", 40], ["up", 50], ["home", 0], ["end", 100]] as const) {
			r.nativeSimulateKeystrokes(v.element().id, key);
			expect(v.value()).toBe(expected);
		}
		const count = v.values.length;
		v.setValue(20);
		v.flush();
		expect(v.values.length).toBe(count);
		expect(v.element().customProps?.["aria-valuetext"]).toBe("20%");
		v.click(0.8, 1);
		expect(v.values.length).toBe(count);
		v.setDisabled(true);
		v.flush();
		v.click(1);
		r.nativeSimulateKeystrokes(v.element().id, "end");
		expect(v.values.length).toBe(count);
		expect(v.element().customProps?.tabIndex).toBe(-1);
		v.root.unmount();
	});
	test("null and unusable native bounds never invent a sample", () => {
		const v = mount(true);
		v.root.renderer.nativeSimulateMouseDown(100, 70);
		expect(v.values).toEqual([]);
		v.root.unmount();
	});
});
