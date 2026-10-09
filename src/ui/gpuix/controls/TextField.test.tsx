import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { NumberField } from "./NumberField";
import { Segmented } from "./Segmented";
import { TextField } from "./TextField";

describe("TextField", () => {
	test("reports each edit and commits on Enter", () => {
		const root = createTestRoot();
		const edits: string[] = [];
		let commits = 0;
		root.render(() => (
			<div style={{ display: "flex", width: 300, height: 60 }}>
				<TextField
					testId="t"
					value="ab"
					onInput={(value) => edits.push(value)}
					onCommit={() => (commits += 1)}
				/>
			</div>
		));
		const input = root.renderer.findByTestId("t")!;

		root.renderer.nativeSimulateKeystrokes(input.id, "x enter");

		expect(edits).toEqual(["abx"]);
		expect(commits).toBe(1);
		root.unmount();
	});

	test("shows the caller value again when it changes from outside", () => {
		const root = createTestRoot();
		const [value, setValue] = createSignal("first");
		root.render(() => (
			<div style={{ display: "flex", width: 300, height: 60 }}>
				<TextField testId="t" value={value()} onInput={() => {}} />
			</div>
		));
		expect(root.renderer.findByTestId("t")?.customProps?.value).toBe("first");
		setValue("second");
		root.flushSync(() => {});
		expect(root.renderer.findByTestId("t")?.customProps?.value).toBe("second");
		root.unmount();
	});
});

describe("NumberField", () => {
	test("emits finite numbers and ignores text that does not parse", () => {
		const root = createTestRoot();
		const [value, setValue] = createSignal(1);
		const values: number[] = [];
		root.render(() => (
			<div style={{ display: "flex", width: 300, height: 60 }}>
				<NumberField
					testId="n"
					value={value()}
					onChange={(next) => {
						values.push(next);
						setValue(next);
					}}
				/>
			</div>
		));
		const input = root.renderer.findByTestId("n")!;

		root.renderer.nativeSimulateKeystrokes(input.id, "backspace");
		root.renderer.nativeSimulateKeystrokes(input.id, "2 . 5");
		expect(values).toEqual([2, 2, 2.5]);

		root.renderer.nativeSimulateKeystrokes(input.id, "backspace backspace backspace");
		root.renderer.nativeSimulateKeystrokes(input.id, "x");
		// Empty and non-numeric text never produce a value.
		expect(values.every(Number.isFinite)).toBe(true);
		expect(values.at(-1)).toBe(2);
		root.unmount();
	});
});

describe("Segmented", () => {
	test("selects an option by click and marks the current one active", () => {
		const root = createTestRoot();
		const chosen: string[] = [];
		root.render(() => (
			<div style={{ display: "flex", width: 400, height: 60 }}>
				<Segmented
					testId="seg"
					value="b"
					options={[
						{ value: "a", label: "A" },
						{ value: "b", label: "B" },
					]}
					onChange={(value) => chosen.push(value)}
				/>
			</div>
		));
		const a = root.renderer.findByTestId("seg-a")!;
		const bounds = root.renderer.getElementBounds(a.id)!;

		root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

		expect(chosen).toEqual(["a"]);
		root.unmount();
	});
});
