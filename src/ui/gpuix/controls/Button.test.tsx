import { describe, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { Button } from "./Button";

const mount = (props: { disabled?: boolean }) => {
	const root = createTestRoot();
	let clicks = 0;
	root.render(() => (
		<div style={{ display: "flex", width: 300, height: 100 }}>
			<Button testId="b" disabled={props.disabled} onClick={() => (clicks += 1)}>
				<text>Go</text>
			</Button>
		</div>
	));
	const button = () => {
		const element = root.renderer.findByTestId("b");
		if (!element) throw new Error("button missing");
		return element;
	};
	return { root, button, clicks: () => clicks };
};

describe("Button", () => {
	test("activates on a click and on Enter", () => {
		const { root, button, clicks } = mount({});
		const bounds = root.renderer.getElementBounds(button().id)!;

		root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		expect(clicks()).toBe(1);

		root.renderer.nativeSimulateKeystrokes(button().id, "enter");
		expect(clicks()).toBe(2);
		root.unmount();
	});

	test("a disabled button ignores clicks and keys", () => {
		const { root, button, clicks } = mount({ disabled: true });
		const bounds = root.renderer.getElementBounds(button().id)!;

		root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		root.renderer.nativeSimulateKeystrokes(button().id, "enter");

		expect(clicks()).toBe(0);
		root.unmount();
	});
});
