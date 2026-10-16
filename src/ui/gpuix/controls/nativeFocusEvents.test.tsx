import { describe, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
describe("8b public native focus/blur boundary", () => {
	for (const input of [false, true]) {
		test(input ? "input loses focus to another focusable control" : "div loses focus to another focusable control", () => {
			const root = createTestRoot();
			const events: string[] = [];
			root.render(() => <div style={{ display: "flex", width: 300, height: 80 }}>
		{input ? <input testId="a" value="draft" onChange={() => { }} onFocus={() => events.push("a:focus")} onBlur={() => events.push("a:blur")} style={{ width: 100, height: 28 }}/>
					: <div testId="a" tabIndex={0} onKeyDown={() => { }} onFocus={() => events.push("a:focus")} onBlur={() => events.push("a:blur")} style={{ width: 100, height: 28 }}/>}
		<div testId="b" tabIndex={0} onKeyDown={() => { }} onFocus={() => events.push("b:focus")} onBlur={() => events.push("b:blur")} style={{ width: 100, height: 28 }}/>
	  </div>);
			try {
				const a = root.renderer.findByTestId("a")!;
				const b = root.renderer.findByTestId("b")!;
				root.renderer.focusElement(a.id);
				expect(root.renderer.getFocusedElementId()).toBe(a.id);
				root.renderer.focusElement(b.id);
				expect(root.renderer.getFocusedElementId()).toBe(b.id);
				root.flushSync(() => { });
				root.renderer.dispatchNativeEvents();
				expect(events).toContain("a:blur");
				expect(events).toContain("b:focus");
			}
			finally {
				root.unmount();
			}
		});
	}
});
