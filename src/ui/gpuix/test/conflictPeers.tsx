import type { JSX } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { createInMemoryCrdtRelay } from "../../../video-editor/dkt/crdt/createInMemoryCrdtRelay";
import { createTestWorkerCrdtTransport } from "../../../video-editor/dkt/crdt/createTestWorkerCrdtTransport";
import { createScenarioDriver, type ScenarioDriver } from "../fixtures/scenarioDriver";
import { waitForAttr, waitForMany, waitForManyScopes, waitForOne } from "../fixtures/scopeWait";
import { createInProcessDkt, type InProcessDkt } from "../host/createInProcessDkt";

const PROFILE = { profileId: "minicut-crdt-v1", profileVersion: 1 } as const;

export type ConflictPeer = {
	id: "A" | "B";
	dkt: InProcessDkt;
	runtime: PageSyncRuntime;
	driver: ScenarioDriver;
	transport: ReturnType<typeof createTestWorkerCrdtTransport>;
};

/**
 * Two full MiniCut DKT runtimes (peer A and peer B) on one in-memory CRDT
 * relay, each with its own page sync runtime. Peer B joins like a second
 * device: it starts empty and receives A's CRDT history. Conflicts are made
 * with real model actions on both sides while the relay is partitioned, so the
 * review items come from the CRDT engine, not from injected meta.
 */
export const createConflictPeers = async (roomId: string) => {
	const relay = createInMemoryCrdtRelay();
	const make = (id: "A" | "B"): ConflictPeer => {
		const transport = createTestWorkerCrdtTransport({
			relay,
			roomId,
			peerId: id,
			...PROFILE,
		});
		const dkt = createInProcessDkt({
			sessionKey: `gpuix-conflict-${id}`,
			crdt: { peerId: id, transport },
		});
		return {
			id,
			dkt,
			runtime: dkt.pageRuntime,
			driver: createScenarioDriver(dkt.pageRuntime),
			transport,
		};
	};
	const a = make("A");
	const b = make("B");
	return {
		a,
		b,
		relay,
		partition() {
			a.transport.setDeliveryPaused(true);
			b.transport.setDeliveryPaused(true);
		},
		heal() {
			a.transport.setDeliveryPaused(false);
			b.transport.setDeliveryPaused(false);
			a.transport.flushBufferedMessages();
			b.transport.flushBufferedMessages();
		},
		destroy() {
			a.driver.destroy();
			b.driver.destroy();
			a.dkt.destroy();
			b.dkt.destroy();
			a.transport.close?.();
			b.transport.close?.();
		},
	};
};

export type ConflictPeers = Awaited<ReturnType<typeof createConflictPeers>>;
export type { ReactSyncScopeHandle };

/** Peer A creates the shared project; call before adding content to it. */
export const createSharedProject = async (peers: ConflictPeers, title = "Shared project") => {
	const { a } = peers;
	const root = await a.driver.root();
	await a.driver.run("createProject", { title });
	const project = await a.driver.waitOne(root, "activeProject");
	const tracks = await a.driver.waitMany(project, "tracks", 2);
	return { project, tracks };
};

/**
 * Peer B joins like a second device: it requests A's CRDT history and makes
 * the shared project its active project. Returns B's scopes for it.
 */
export const joinSharedProject = async (peers: ConflictPeers, projectNodeId: string) => {
	const { b } = peers;
	const root = await b.driver.root();
	b.transport.requestSync("gpuix-join");
	const pioneer = await b.driver.waitOne(root, "pioneer");
	// A's boot project, B's boot project and the shared one.
	await b.driver.waitMany(pioneer, "project", 3);
	await b.driver.run("setActiveProject", projectNodeId);
	const project = (await waitForOne(
		b.runtime,
		root,
		"activeProject",
		(target) => target?._nodeId === projectNodeId,
	)) as ReactSyncScopeHandle;
	const tracks = await b.driver.waitMany(project, "tracks", 2);
	return { project, tracks };
};

export const untilPeerAttr = (
	peer: ConflictPeer,
	scope: ReactSyncScopeHandle,
	attr: string,
	predicate: (value: unknown) => boolean,
) => waitForAttr(peer.runtime, scope, attr, predicate);

export const untilPeerMany = (
	peer: ConflictPeer,
	scope: ReactSyncScopeHandle,
	rel: string,
	predicate: (count: number) => boolean,
) => waitForMany(peer.runtime, scope, rel, predicate);

export const untilPeerScopes = (
	peer: ConflictPeer,
	scope: ReactSyncScopeHandle,
	rel: string,
	predicate: (members: readonly ReactSyncScopeHandle[]) => boolean,
) => waitForManyScopes(peer.runtime, scope, rel, predicate);

/** The app UI of `code` on one peer's page runtime, on the headless renderer. */
export const renderOnPeer = (peer: ConflictPeer, code: () => JSX.Element) => {
	const root = createTestRoot({ width: 1280, height: 800 });
	root.render(() => (
		<div style={{ width: "100%", height: "100%" }}>
			<RootScope runtime={peer.runtime}>{code()}</RootScope>
		</div>
	));
	const find = (testId: string, index = 0) => {
		const element = root.renderer
			.findByType("div")
			.filter((candidate) => candidate.testId === testId)[index];
		if (!element) throw new Error(`No element ${index} with testId "${testId}"`);
		return element;
	};
	const findText = (testId: string, index = 0) => {
		const element = root.renderer
			.findByType("text")
			.filter((candidate) => candidate.testId === testId)[index];
		if (!element) throw new Error(`No text ${index} with testId "${testId}"`);
		return element;
	};
	return {
		root,
		texts: () => root.renderer.getAllText(),
		settle: () => root.flushSync(() => {}),
		findAll: (testId: string) =>
			root.renderer.findByType("div").filter((candidate) => candidate.testId === testId),
		countTexts: (testId: string) =>
			root.renderer.findByType("text").filter((candidate) => candidate.testId === testId).length,
		has: (testId: string) =>
			root.renderer.findByType("div").some((candidate) => candidate.testId === testId),
		textOf: (testId: string, index = 0) =>
			findText(testId, index)
				.children.map((id) => root.renderer.getElement(id)?.text ?? "")
				.join(""),
		click(testId: string, index = 0) {
			const bounds = root.renderer.getElementBounds(find(testId, index).id);
			if (!bounds) throw new Error(`Element "${testId}" has no bounds`);
			root.renderer.nativeSimulateClick(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height / 2,
			);
		},
		/** Types into the input with the test id (keystroke names, space separated). */
		type(testId: string, keys: string) {
			const input = root.renderer.findByTestId(testId);
			if (!input) throw new Error(`No input with testId "${testId}"`);
			root.renderer.nativeSimulateKeystrokes(input.id, keys);
		},
		destroy: () => root.unmount(),
	};
};
