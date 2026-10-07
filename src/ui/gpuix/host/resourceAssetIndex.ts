import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";

/**
 * Temporary host projection until the model carries sourceKind/sourceRef in
 * recovery payloads and plan clipSources and schedules boot restore itself
 * (model gap M10).
 *
 * Page-side map from a resource node id to the asset id of its local file,
 * built from the synced `sourceRef` attr of the active project's resources.
 * Export and preview plans identify sources by `resourceId` only (their
 * `resourceUrl` is blanked for non-portable urls); the Web page resolves the
 * same ids through its transfer manager, which is fed from the page runtime in
 * the same way. It is a projection of synced data and holds no state of its
 * own: it is rebuilt from the graph on every change.
 */
export type ResourceAssetIndex = {
	/** Asset id registered for the resource, or null when it has none. */
	assetIdFor(resourceId: string): string | null;
	/** Content key (fingerprint version + fingerprint) of the resource file, or null. */
	contentKeyFor(resourceId: string): string | null;
	/** Every resource that currently has an asset (resource node id -> asset id). */
	entries(): ReadonlyMap<string, string>;
	/** Called after the map changed (a resource appeared, was relinked, ...). */
	subscribe(listener: () => void): () => void;
	dispose(): void;
};

export type ResourceAssetIndexPage = Pick<
	PageSyncRuntime,
	| "getRootScope"
	| "subscribeRootScope"
	| "mountShape"
	| "readOne"
	| "subscribeOne"
	| "readMany"
	| "subscribeMany"
	| "readAttrs"
	| "subscribeAttrs"
>;

const sourceAttrs = [
	"sourceKind",
	"sourceRef",
	"contentFingerprint",
	"fingerprintVersion",
] as const;

const indexShape = defineShape({
	one: {
		activeProject: defineShape({
			many: { resources: defineShape({ attrs: [...sourceAttrs] }) },
		}),
	},
});

export const createResourceAssetIndex = (
	page: ResourceAssetIndexPage,
): ResourceAssetIndex => {
	let byResource = new Map<string, string>();
	let contentKeys = new Map<string, string>();
	const listeners = new Set<() => void>();
	let disposed = false;
	let releaseShape = () => {};
	let releaseProject = () => {};
	let releaseResources = () => {};
	let releaseAttrs = () => {};
	let releaseRootRel = () => {};

	const publish = (
		next: Map<string, string>,
		nextKeys: Map<string, string>,
	): void => {
		const same =
			next.size === byResource.size &&
			[...next].every(([key, value]) => byResource.get(key) === value) &&
			nextKeys.size === contentKeys.size &&
			[...nextKeys].every(([key, value]) => contentKeys.get(key) === value);
		byResource = next;
		contentKeys = nextKeys;
		if (same) return;
		for (const listener of [...listeners]) listener();
	};

	const attachAttrs = (project: ReturnType<typeof page.readOne>): void => {
		releaseAttrs();
		releaseAttrs = () => {};
		if (!project) {
			publish(new Map(), new Map());
			return;
		}
		const members = page.readMany(project, "resources"); // guard-ok: model gap, export/preview/recovery payloads lack the resource sourceRef (page-side projection like web transfer manager)
		const rebuild = (): void => {
			const next = new Map<string, string>();
			const nextKeys = new Map<string, string>();
			for (const member of members) {
				const attrs = page.readAttrs(member, [...sourceAttrs]); // guard-ok: same model gap (sourceRef not in effect payloads)
				const value = attrs.sourceRef;
				if (typeof value === "string" && value) next.set(member._nodeId, value);
				if (
					typeof attrs.contentFingerprint === "string" &&
					attrs.contentFingerprint &&
					typeof attrs.fingerprintVersion === "string"
				) {
					nextKeys.set(
						member._nodeId,
						`${attrs.fingerprintVersion}:${attrs.contentFingerprint}`,
					);
				}
			}
			publish(next, nextKeys);
		};
		const stops = members.map((member) =>
			page.subscribeAttrs(member, [...sourceAttrs], rebuild),
		);
		releaseAttrs = () => {
			for (const stop of stops) stop();
		};
		rebuild();
	};

	const attachProject = (root: NonNullable<ReturnType<typeof page.getRootScope>>): void => {
		releaseResources();
		releaseResources = () => {};
		const project = page.readOne(root, "activeProject"); // guard-ok: same model gap (sourceRef not in effect payloads)
		if (!project) {
			attachAttrs(null);
			return;
		}
		releaseResources = page.subscribeMany(project, "resources", () =>
			attachAttrs(project),
		);
		attachAttrs(project);
	};

	const attachRoot = (): void => {
		const root = page.getRootScope();
		if (!root || disposed) return;
		releaseShape();
		releaseRootRel();
		releaseShape = page.mountShape(root, indexShape);
		releaseRootRel = page.subscribeOne(root, "activeProject", () =>
			attachProject(root),
		);
		attachProject(root);
	};

	const releaseRoot = page.subscribeRootScope(attachRoot);
	attachRoot();

	return {
		assetIdFor: (resourceId) => byResource.get(resourceId) ?? null,
		contentKeyFor: (resourceId) => contentKeys.get(resourceId) ?? null,
		entries: () => byResource,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			releaseRoot();
			releaseRootRel();
			releaseProject();
			releaseResources();
			releaseAttrs();
			releaseShape();
			listeners.clear();
		},
	};
};
