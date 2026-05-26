import type { ReactSyncScopeHandle } from "../scope/ScopeHandle";
import type { DefinedReactShape } from "./defineShape";

type Listener = () => void;

export type ReactTransportShape = {
	id: string;
	t: 0;
	a?: readonly string[];
	r?: readonly string[];
};

type CompiledShape = {
	id: string;
	graph: Record<string, ReactTransportShape>;
	one: ReadonlyArray<readonly [string, CompiledShape]>;
	many: ReadonlyArray<readonly [string, CompiledShape]>;
};

export interface ShapeRegistryRuntime {
	publishShapeGraph(graph: Record<string, ReactTransportShape>): void;
	requireNodeShapes(nodeId: string, shapeIds: readonly string[]): void;
	readOne(
		scope: ReactSyncScopeHandle,
		relName: string,
	): ReactSyncScopeHandle | null;
	subscribeOne(
		scope: ReactSyncScopeHandle,
		relName: string,
		listener: Listener,
	): () => void;
	readMany(
		scope: ReactSyncScopeHandle,
		relName: string,
	): readonly ReactSyncScopeHandle[];
	subscribeMany(
		scope: ReactSyncScopeHandle,
		relName: string,
		listener: Listener,
	): () => void;
}

const EMPTY_CLEANUP = () => {};

const once = (cleanup: () => void) => {
	let active = true;

	return () => {
		if (!active) {
			return;
		}

		active = false;
		cleanup();
	};
};

const freezeShapeGraph = (graph: Record<string, ReactTransportShape>) =>
	Object.freeze({ ...graph });

const toSortedUnique = (values: readonly string[]) =>
	Object.freeze(Array.from(new Set(values)).sort());

export class ShapeRegistry {
	private compiledByShapeId: Map<string, CompiledShape>;

	private compilingShapeIds: Set<string>;

	private publishedShapeIds: Set<string>;

	private activeShapeRefsByNodeId: Map<string, Map<string, number>>;

	private requestedShapeSetsByNodeId: Map<string, string>;

	constructor() {
		this.compiledByShapeId = new Map();
		this.compilingShapeIds = new Set();
		this.publishedShapeIds = new Set();
		this.activeShapeRefsByNodeId = new Map();
		this.requestedShapeSetsByNodeId = new Map();
	}

	mount(
		runtime: ShapeRegistryRuntime,
		scope: ReactSyncScopeHandle,
		shape: DefinedReactShape,
	) {
		const compiled = this.compileShape(shape);

		this.ensurePublished(runtime, compiled);

		return this.mountCompiledShape(runtime, scope, compiled);
	}

	destroy() {
		this.compiledByShapeId.clear();
		this.compilingShapeIds.clear();
		this.publishedShapeIds.clear();
		this.activeShapeRefsByNodeId.clear();
		this.requestedShapeSetsByNodeId.clear();
	}

	private compileShape(shape: DefinedReactShape): CompiledShape {
		const cached = this.compiledByShapeId.get(shape.id);
		if (cached) {
			return cached;
		}

		if (this.compilingShapeIds.has(shape.id)) {
			throw new Error(`cyclic react shape "${shape.id}" is not supported`);
		}

		this.compilingShapeIds.add(shape.id);

		try {
			const one = Object.entries(shape.one ?? {}).map(
				([relName, nestedShape]) =>
					[relName, this.compileShape(nestedShape)] as const,
			);
			const many = Object.entries(shape.many ?? {}).map(
				([relName, nestedShape]) =>
					[relName, this.compileShape(nestedShape)] as const,
			);

			const relNames = toSortedUnique([
				...(shape.rels ?? []),
				...one.map(([relName]) => relName),
				...many.map(([relName]) => relName),
			]);

			const graph: Record<string, ReactTransportShape> = {};

			for (let i = 0; i < one.length; i += 1) {
				Object.assign(graph, one[i][1].graph);
			}

			for (let i = 0; i < many.length; i += 1) {
				Object.assign(graph, many[i][1].graph);
			}

			graph[shape.id] = Object.freeze({
				id: shape.id,
				t: 0 as const,
				a: shape.attrs?.length ? shape.attrs : undefined,
				r: relNames.length ? relNames : undefined,
			});

			const compiled = Object.freeze({
				id: shape.id,
				graph: freezeShapeGraph(graph),
				one: Object.freeze(one),
				many: Object.freeze(many),
			});

			this.compiledByShapeId.set(shape.id, compiled);

			return compiled;
		} finally {
			this.compilingShapeIds.delete(shape.id);
		}
	}

	private ensurePublished(
		runtime: ShapeRegistryRuntime,
		compiled: CompiledShape,
	) {
		const freshGraph: Record<string, ReactTransportShape> = {};
		let hasFresh = false;

		for (const shapeId in compiled.graph) {
			if (!Object.hasOwn(compiled.graph, shapeId)) {
				continue;
			}

			if (this.publishedShapeIds.has(shapeId)) {
				continue;
			}

			freshGraph[shapeId] = compiled.graph[shapeId];
			hasFresh = true;
		}

		if (!hasFresh) {
			return;
		}

		runtime.publishShapeGraph(freshGraph);

		for (const shapeId in freshGraph) {
			if (!Object.hasOwn(freshGraph, shapeId)) {
				continue;
			}

			this.publishedShapeIds.add(shapeId);
		}
	}

	private mountCompiledShape(
		runtime: ShapeRegistryRuntime,
		scope: ReactSyncScopeHandle,
		compiled: CompiledShape,
	) {
		const cleanups: Array<() => void> = [];

		cleanups.push(this.retainShape(runtime, scope._nodeId, compiled.id));

		for (let i = 0; i < compiled.one.length; i += 1) {
			const [relName, nestedShape] = compiled.one[i];
			cleanups.push(
				this.mountOneRelation(runtime, scope, relName, nestedShape),
			);
		}

		for (let i = 0; i < compiled.many.length; i += 1) {
			const [relName, nestedShape] = compiled.many[i];
			cleanups.push(
				this.mountManyRelation(runtime, scope, relName, nestedShape),
			);
		}

		return once(() => {
			for (let i = cleanups.length - 1; i >= 0; i -= 1) {
				cleanups[i]();
			}
		});
	}

	private mountOneRelation(
		runtime: ShapeRegistryRuntime,
		scope: ReactSyncScopeHandle,
		relName: string,
		nestedShape: CompiledShape,
	) {
		let childNodeId: string | null = null;
		let stopChild = EMPTY_CLEANUP;

		const sync = () => {
			const childScope = runtime.readOne(scope, relName);
			const nextNodeId = childScope?._nodeId ?? null;

			if (nextNodeId === childNodeId) {
				return;
			}

			stopChild();
			childNodeId = nextNodeId;
			stopChild = childScope
				? this.mountCompiledShape(runtime, childScope, nestedShape)
				: EMPTY_CLEANUP;
		};

		const stopRel = runtime.subscribeOne(scope, relName, sync);
		sync();

		return once(() => {
			stopRel();
			stopChild();
		});
	}

	private mountManyRelation(
		runtime: ShapeRegistryRuntime,
		scope: ReactSyncScopeHandle,
		relName: string,
		nestedShape: CompiledShape,
	) {
		const childCleanups = new Map<string, () => void>();

		const sync = () => {
			const childScopes = runtime.readMany(scope, relName);
			const nextNodeIds = new Set<string>();

			for (let i = 0; i < childScopes.length; i += 1) {
				const childScope = childScopes[i];
				nextNodeIds.add(childScope._nodeId);

				if (childCleanups.has(childScope._nodeId)) {
					continue;
				}

				childCleanups.set(
					childScope._nodeId,
					this.mountCompiledShape(runtime, childScope, nestedShape),
				);
			}

			for (const [nodeId, cleanup] of childCleanups) {
				if (nextNodeIds.has(nodeId)) {
					continue;
				}

				childCleanups.delete(nodeId);
				cleanup();
			}
		};

		const stopRel = runtime.subscribeMany(scope, relName, sync);
		sync();

		return once(() => {
			stopRel();

			for (const cleanup of childCleanups.values()) {
				cleanup();
			}

			childCleanups.clear();
		});
	}

	private retainShape(
		runtime: ShapeRegistryRuntime,
		nodeId: string,
		shapeId: string,
	) {
		let nodeRefs = this.activeShapeRefsByNodeId.get(nodeId);
		if (!nodeRefs) {
			nodeRefs = new Map();
			this.activeShapeRefsByNodeId.set(nodeId, nodeRefs);
		}

		const previousRefs = nodeRefs.get(shapeId) ?? 0;
		nodeRefs.set(shapeId, previousRefs + 1);

		if (previousRefs === 0) {
			this.syncNodeShapes(runtime, nodeId);
		}

		return once(() => {
			const currentNodeRefs = this.activeShapeRefsByNodeId.get(nodeId);
			if (!currentNodeRefs) {
				return;
			}

			const currentRefs = currentNodeRefs.get(shapeId) ?? 0;

			if (currentRefs <= 1) {
				currentNodeRefs.delete(shapeId);
			} else {
				currentNodeRefs.set(shapeId, currentRefs - 1);
			}

			if (!currentNodeRefs.size) {
				this.activeShapeRefsByNodeId.delete(nodeId);
			}

			if (currentRefs <= 1) {
				this.syncNodeShapes(runtime, nodeId);
			}
		});
	}

	private syncNodeShapes(runtime: ShapeRegistryRuntime, nodeId: string) {
		const nodeRefs = this.activeShapeRefsByNodeId.get(nodeId);
		const shapeIds = nodeRefs ? Array.from(nodeRefs.keys()).sort() : [];
		const signature = shapeIds.join("\u001f");

		if (this.requestedShapeSetsByNodeId.get(nodeId) === signature) {
			return;
		}

		this.requestedShapeSetsByNodeId.set(nodeId, signature);
		runtime.requireNodeShapes(nodeId, shapeIds);
	}
}
