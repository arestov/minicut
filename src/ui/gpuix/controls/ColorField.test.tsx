import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { ColorField } from "./ColorField";
const swatches = ["2563eb", "16a34a", "dc2626", "ca8a04", "7c3aed", "0891b2"];
const mount = () => {
	const root = createTestRoot();
	const [value, setValue] = createSignal("#2563eb");
	const [owner, setOwner] = createSignal("a");
	const [disabled, setDisabled] = createSignal(false);
	const changes: string[] = [];
	root.render(() => <div style={{ display: "flex", width: 400, height: 200 }}><ColorField testId="c" label="Color" value={value()} identityKey={owner()} disabled={disabled()} onChange={n => { changes.push(n); setValue(n); }}/></div>);
	const el = (id = "c") => root.renderer.findByTestId(id)!;
	const type = (text: string) => { root.renderer.nativeSimulateKeystrokes(el().id, Array(7).fill("backspace").join(" ")); if (text)
		root.renderer.nativeSimulateKeystrokes(el().id, text.split("").join(" ")); };
	return { root, value, setValue, setOwner, setDisabled, changes, el, type, flush: () => root.flushSync(() => { }) };
};
describe("ColorField", () => {
	test("all six swatches activate by mouse and keyboard with canonical preview", () => {
		const v = mount();
		for (const hex of swatches) {
			v.setValue("#abcdef");
			v.flush();
			const el = v.el("c-" + hex);
			const b = v.root.renderer.getElementBounds(el.id)!;
			v.root.renderer.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
			expect(v.value()).toBe("#" + hex);
			for (const key of ["enter", "space"]) {
				v.setValue("#abcdef");
				v.flush();
				v.root.renderer.nativeSimulateKeystrokes(el.id, key);
				expect(v.value()).toBe("#" + hex);
			}
			expect(v.el("c-" + hex).customProps?.["aria-selected"]).toBe(true);
		}
		v.root.unmount();
	});
	test("arbitrary opaque hex emits immediately without submit or blur duplicates", () => {
		const v = mount();
		for (const text of ["#abcdef", "#000000", "#ffffff", "#ABCDEF"]) {
			v.type(text);
			expect(v.value()).toBe(text.toLowerCase());
			const count = v.changes.length;
			v.root.renderer.nativeSimulateKeystrokes(v.el().id, "enter");
			v.root.renderer.focusElement(v.el("c-2563eb").id);
			expect(v.changes.length).toBe(count);
		}
		v.root.unmount();
	});
	test("invalid drafts remain local and revert on submit blur escape or external owner/value", () => {
		const v = mount();
		for (const text of ["", "#", "123456", "#abc", "#abcdex00", "#zzzzzz", "rgb(1)"]) {
			const count = v.changes.length;
			v.type(text);
			expect(v.el().customProps?.value).toBe(text);
			expect(v.changes.length).toBe(count);
			v.root.renderer.nativeSimulateKeystrokes(v.el().id, "enter");
			expect(v.el().customProps?.value).toBe(v.value());
		}
		v.type("#abcdef78");
		expect(v.value()).toBe("#abcdef");
		expect(v.el().customProps?.value).toBe("#abcdef78");
		const alphaCount = v.changes.length;
		v.root.renderer.focusElement(v.el("c-2563eb").id);
		expect(v.el().customProps?.value).toBe("#abcdef");
		expect(v.changes.length).toBe(alphaCount);
		v.type("#ab");
		v.root.renderer.focusElement(v.el("c-2563eb").id);
		expect(v.el().customProps?.value).toBe(v.value());
		v.type("#ab");
		v.root.renderer.nativeSimulateKeystrokes(v.el().id, "escape");
		expect(v.el().customProps?.value).toBe(v.value());
		v.type("#ab");
		v.setValue("#123456");
		v.flush();
		expect(v.el().customProps?.value).toBe("#123456");
		v.type("#ab");
		v.setOwner("b");
		v.flush();
		expect(v.el().customProps?.value).toBe("#123456");
		v.setValue("malformed");
		v.flush();
		expect(v.el().customProps?.value).toBe("malformed");
		v.root.unmount();
	});
	test("disabled input and swatches cannot dispatch", () => {
		const v = mount();
		v.setDisabled(true);
		v.flush();
		v.type("#abcdef");
		for (const hex of swatches)
			v.root.renderer.nativeSimulateKeystrokes(v.el("c-" + hex).id, "enter space");
		expect(v.changes).toEqual([]);
		expect(v.el().customProps?.readOnly).toBe(true);
		expect(v.el().customProps?.tabIndex).toBe(-1);
		v.root.unmount();
	});
});
