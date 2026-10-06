import { createTestRoot, TestRenderer } from "@gpuix/solid/testing";
import { createSignal } from "solid-js";
import { expect, test } from "bun:test";

test("solid universal renderer works under bun", () => {
	const t = createTestRoot();
	const [n, setN] = createSignal(1);
	t.render(() => <div>{n()}</div>);
	t.flushSync(() => setN(2));
	expect(t.renderer).toBeInstanceOf(TestRenderer);
	t.unmount();
});
