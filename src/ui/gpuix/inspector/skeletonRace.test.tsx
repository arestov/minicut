import { afterEach, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import {
	createSkeletonRaceFixture,
	type SkeletonRaceFixture,
} from "../fixtures/skeletonRace";
import { ClipInspector } from "./ClipInspector";

let fixture: SkeletonRaceFixture | null = null;

afterEach(() => {
	fixture?.destroy();
	fixture = null;
});

test("the inspector waits for the selected clip's attrs before showing fields", () => {
	const current = createSkeletonRaceFixture([]);
	fixture = current;
	const root = createTestRoot();
	root.render(() => (
		<div style={{ display: "flex", width: 400, height: 300 }}>
			<RootScope runtime={current.runtime}>
				<ClipInspector />
			</RootScope>
		</div>
	));
	const fields = () =>
		root.renderer.findByType("div").filter((e) => e.testId === "inspector-opacity-inc").length;
	expect(root.renderer.getAllText()).toContain("No clip selected");

	// The rel arrives before the clip's attrs: still the placeholder.
	root.flushSync(() => current.deliverSelectedClipRel("clip-1"));
	expect(root.renderer.getAllText()).toContain("No clip selected");
	expect(fields()).toBe(0);

	root.flushSync(() => current.deliverAttrs("clip-1", { name: "Early", start: 1, duration: 2 }));
	expect(root.renderer.getAllText()).not.toContain("No clip selected");
	expect(fields()).toBe(1);
	// Attrs the model has not delivered fall back to the model defaults.
	expect(root.renderer.getAllText()).toContain("100%");

	root.flushSync(() => current.deliverSelectedClipRel(null));
	expect(root.renderer.getAllText()).toContain("No clip selected");
	root.unmount();
});
