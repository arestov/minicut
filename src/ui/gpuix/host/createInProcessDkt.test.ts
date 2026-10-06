import { afterEach, expect, test } from "bun:test";
import { createInProcessDkt, type InProcessDkt } from "./createInProcessDkt";

let dkt: InProcessDkt | null = null;

afterEach(() => {
	dkt?.destroy();
	dkt = null;
});

const whenReady = (pageRuntime: InProcessDkt["pageRuntime"]) =>
	new Promise<void>((resolve) => {
		const check = () => {
			if (pageRuntime.getSnapshot().ready) {
				unsubscribe();
				resolve();
			}
		};
		const unsubscribe = pageRuntime.subscribe(check);
		check();
	});

test("boots the real DKT runtime on memory storage and syncs the root", async () => {
	dkt = createInProcessDkt();

	await whenReady(dkt.pageRuntime);

	const snapshot = dkt.pageRuntime.getSnapshot();
	expect(snapshot.booted).toBe(true);
	expect(snapshot.rootNodeId).toEqual(expect.any(String));
	expect(snapshot.runtimeError).toBeNull();
});
