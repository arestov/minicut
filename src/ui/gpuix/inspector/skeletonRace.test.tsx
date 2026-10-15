import { afterEach, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import {
	createSkeletonRaceFixture,
	type SkeletonRaceFixture,
} from "../fixtures/skeletonRace";
import { Inspector } from "./Inspector";

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
				<Inspector />
			</RootScope>
		</div>
	));
	const fields = () =>
		root.renderer.findByType("div").filter((e) => e.testId === "inspector-header").length;
	expect(root.renderer.getAllText()).toContain("No clip selected");

	// The rel arrives before the clip's attrs: still the placeholder.
	root.flushSync(() => current.deliverSelectedClipRel("clip-1"));
	expect(root.renderer.getAllText()).toContain("No clip selected");
	expect(fields()).toBe(0);
 expect(root.renderer.findByTestId("inspector-tabs-edit")!.customProps?.tabIndex).toBe(-1);

	root.flushSync(() => current.deliverAttrs("clip-1", { name: "Early", start: 1, duration: 2 }));
	expect(root.renderer.getAllText()).not.toContain("No clip selected");
	expect(fields()).toBe(1);
	// Attrs the model has not delivered fall back to the model defaults.
	expect(root.renderer.getAllText()).toContain("Clip 1 - Track - 1.0s - Duration 2.0s");

	root.flushSync(() => current.deliverSelectedClipRel(null));
	expect(root.renderer.getAllText()).toContain("No clip selected");
	root.unmount();
});

test("late resource kind and canonical root tab update through declared scopes", () => {
 const current = createSkeletonRaceFixture([]);
 fixture = current;
 const root = createTestRoot();
 root.render(() => <div style={{ display: "flex", width: 400, height: 500 }}><RootScope runtime={current.runtime}><Inspector /></RootScope></div>);
 root.flushSync(() => {
  current.deliverSelectedClipRel("clip-a");
  current.deliverAttrs("clip-a", { name: "Audio", start: 0, duration: 2, color: "#abcdef", mediaKind: null });
  current.deliverResourceRel("clip-a", "resource-a");
 });
 expect(root.renderer.getAllText()).toContain("CLIP");
 root.flushSync(() => current.deliverAttrs("resource-a", { kind: "audio" }));
 expect(root.renderer.getAllText()).toContain("AUD");
 root.flushSync(() => current.deliverAttrs("root", { activeInspectorTab: "invalid" }));
 expect(root.renderer.findByTestId("inspector-panel-edit")).toBeDefined();
 expect(current.runtime.readAttrs(current.runtime.getRootScope()!, ["activeInspectorTab"]).activeInspectorTab).toBe("invalid");
 root.flushSync(() => current.deliverAttrs("root", { activeInspectorTab: "audio" }));
 expect(root.renderer.findByTestId("inspector-panel-audio")).toBeDefined();
 root.flushSync(() => current.deliverAttrs("clip-a", { mediaKind: "video" }));
 expect(root.renderer.getAllText()).toContain("CLIP");
 root.flushSync(() => { current.deliverSelectedClipRel("clip-b"); current.deliverAttrs("clip-b", { name: "Other" }); });
 expect(root.renderer.getAllText()).not.toContain("AUD");
 expect(root.renderer.findByTestId("inspector-thumbnail")!.customProps?.["aria-label"]).toBe("Other clip preview unavailable");
 root.unmount();
});
