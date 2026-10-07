import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { DomSyncPortLike } from "dkt/dom-sync/transport.js";
import { createPortTransport } from "../shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../shared/messageTypes";
import { createMiniCutPageSyncRuntime } from "./createMiniCutPageSyncRuntime";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const hostSource = path.join(
	repoRoot,
	"src/video-editor/dkt/test/workerSyncHost.ts",
);
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// Bun runs the TypeScript host directly; its alias plugin is a preload, which
// worker_threads do not inherit, so it is passed explicitly. Node cannot load
// the TypeScript host with `dkt` aliases, so it runs an esbuild bundle of it.
const createWorker = async (tempDir: string): Promise<Worker> => {
	if (isBun) {
		return new Worker(pathToFileURL(hostSource), {
			preload: [
				path.join(repoRoot, "src/dkt-solid-sync/test/dktAliasPreload.ts"),
			],
		} as ConstructorParameters<typeof Worker>[1]);
	}
	const { build } = await import("esbuild");
	const { resolveDktAliasPath } = await import("../../../../scripts/dktAliases.mjs");
	const outfile = path.join(tempDir, "workerSyncHost.mjs");
	await build({
		entryPoints: [hostSource],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		logLevel: "silent",
		define: { "import.meta.env": "{}" },
		banner: {
			js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
		},
		plugins: [
			{
				name: "dkt-alias",
				setup(b) {
					b.onResolve({ filter: /^dkt(-all)?(\/|$)/ }, async (args) => {
						const target = resolveDktAliasPath(args.path);
						return target
							? b.resolve(target, { kind: args.kind, resolveDir: "/" })
							: undefined;
					});
				},
			},
		],
	});
	return new Worker(pathToFileURL(outfile));
};

const waitFor = <T>(
	subscribe: (listener: () => void) => () => void,
	read: () => T | null | undefined,
): Promise<T> =>
	new Promise<T>((resolve) => {
		const check = () => {
			const value = read();
			if (value !== null && value !== undefined) {
				stop();
				resolve(value);
			}
		};
		const stop = subscribe(check);
		check();
	});

const projectShape = defineShape({
	attrs: ["title"],
	many: { tracks: defineShape({ attrs: ["kind", "name"] }) },
});
const rootShape = defineShape({
	attrs: ["activeProjectId"],
	one: { activeProject: projectShape },
});

describe(`DKT worker sync over MessagePort (${isBun ? "bun" : "node"})`, () => {
	let worker: Worker | null = null;
	let runtime: PageSyncRuntime | null = null;
	let tempDir: string | null = null;

	afterEach(async () => {
		runtime?.destroy();
		await worker?.terminate();
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
		worker = null;
		runtime = null;
		tempDir = null;
	});

	it("handshakes, syncs a mounted shape and syncs an action back", async () => {
		tempDir = mkdtempSync(path.join(tmpdir(), "minicut-worker-sync-"));
		worker = await createWorker(tempDir);
		const workerErrors: unknown[] = [];
		worker.on("error", (error) => workerErrors.push(error));

		const page = createMiniCutPageSyncRuntime({
			transport: createPortTransport<MiniCutDktTransportMessage>(
				worker as unknown as DomSyncPortLike<MiniCutDktTransportMessage>,
			),
		});
		runtime = page;

		// handshake + initial sync
		page.bootstrap({ sessionKey: "worker-sync-test" });
		const root = await waitFor(
			(listener) => page.subscribeRootScope(listener),
			() => page.getRootScope(),
		);
		await waitFor(
			(listener) => page.subscribe(listener),
			() => (page.getSnapshot().ready ? true : null),
		);
		expect(page.getSnapshot()).toMatchObject({
			booted: true,
			ready: true,
			sessionKey: "worker-sync-test",
			runtimeError: null,
		});

		// shape mount
		const release = page.mountShape(root, rootShape);

		// action (mutation step) ...
		await page.dispatchAndWait("createProject", { title: "Worker project" });

		// ... and its sync back (read step)
		const project = await waitFor<ReactSyncScopeHandle>(
			(listener) => page.subscribeOne(root, "activeProject", listener),
			() => page.readOne(root, "activeProject"),
		);
		const title = await waitFor<string>(
			(listener) => page.subscribeAttrs(project, ["title"], listener),
			() => page.readAttrs(project, ["title"]).title as string | undefined,
		);
		expect(title).toBe("Worker project");
		const tracks = await waitFor(
			(listener) => page.subscribeMany(project, "tracks", listener),
			() => {
				const members = page.readMany(project, "tracks");
				return members.length >= 2 ? members : null;
			},
		);
		expect(tracks.length).toBeGreaterThanOrEqual(2);

		release();
		expect(workerErrors).toEqual([]);
	});
});
