/**
 * TESTING AND DEBUG ONLY — DO NOT USE IN PRODUCTION CODE
 *
 * Graph diff helper for jsdom REPL and test scenarios.
 * Compares two debugDumpGraph() snapshots and reports what changed.
 *
 * Usage in REPL scenario:
 *
 *   const before = harness.inspect.graph()
 *   harness.dispatchRootAction('importFilesRequested', { files })
 *   await harness.flush(4)
 *   const after = harness.inspect.graph()
 *   console.log(diffGraph(before, after))
 */

import type { ReactSyncDebugGraph, ReactSyncDebugNode } from '../../src/dkt-react-sync/receiver/ReactSyncReceiver'

export interface GraphDiffAttrChange {
	oldValue: unknown
	newValue: unknown
}

export interface GraphDiffNodeChanges {
	nodeId: string
	modelName: string | null
	attrsChanged: Record<string, GraphDiffAttrChange>
	relsChanged: Record<string, { oldRels: unknown; newRels: unknown }>
}

export interface GraphDiff {
	addedNodes: Array<{ nodeId: string; modelName: string | null }>
	removedNodes: Array<{ nodeId: string; modelName: string | null }>
	nodeChanges: GraphDiffNodeChanges[]
	summary: {
		addedCount: number
		removedCount: number
		changedCount: number
		totalNodesBefore: number
		totalNodesAfter: number
	}
}

const buildNodeMap = (graph: unknown): Map<string, ReactSyncDebugNode> => {
	const map = new Map<string, ReactSyncDebugNode>()
	const g = graph as ReactSyncDebugGraph | null
	if (!g || !Array.isArray(g.nodes)) {
		return map
	}
	for (const node of g.nodes) {
		if (node && typeof node.nodeId === 'string') {
			map.set(node.nodeId, node)
		}
	}
	return map
}

const diffNodeAttrs = (
	before: ReactSyncDebugNode,
	after: ReactSyncDebugNode,
): Record<string, GraphDiffAttrChange> => {
	const changes: Record<string, GraphDiffAttrChange> = {}
	const beforeAttrs = before.attrs ?? {}
	const afterAttrs = after.attrs ?? {}
	const allKeys = new Set([...Object.keys(beforeAttrs), ...Object.keys(afterAttrs)])
	for (const key of allKeys) {
		const oldVal = beforeAttrs[key]
		const newVal = afterAttrs[key]
		if (oldVal !== newVal) {
			changes[key] = { oldValue: oldVal, newValue: newVal }
		}
	}
	return changes
}

const diffNodeRels = (
	before: ReactSyncDebugNode,
	after: ReactSyncDebugNode,
): Record<string, { oldRels: unknown; newRels: unknown }> => {
	const changes: Record<string, { oldRels: unknown; newRels: unknown }> = {}
	const beforeRels = before.rels ?? {}
	const afterRels = after.rels ?? {}
	const allKeys = new Set([...Object.keys(beforeRels), ...Object.keys(afterRels)])
	for (const key of allKeys) {
		const oldVal = beforeRels[key]
		const newVal = afterRels[key]
		if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
			changes[key] = { oldRels: oldVal, newRels: newVal }
		}
	}
	return changes
}

export const diffGraph = (beforeGraph: unknown, afterGraph: unknown): GraphDiff => {
	const beforeMap = buildNodeMap(beforeGraph)
	const afterMap = buildNodeMap(afterGraph)

	const addedNodes: GraphDiff['addedNodes'] = []
	const removedNodes: GraphDiff['removedNodes'] = []
	const nodeChanges: GraphDiff['nodeChanges'] = []

	for (const [nodeId, node] of afterMap) {
		if (!beforeMap.has(nodeId)) {
			addedNodes.push({ nodeId, modelName: node.modelName })
		}
	}

	for (const [nodeId, node] of beforeMap) {
		if (!afterMap.has(nodeId)) {
			removedNodes.push({ nodeId, modelName: node.modelName })
		}
	}

	for (const [nodeId, afterNode] of afterMap) {
		const beforeNode = beforeMap.get(nodeId)
		if (!beforeNode) {
			continue
		}

		const attrsChanged = diffNodeAttrs(beforeNode, afterNode)
		const relsChanged = diffNodeRels(beforeNode, afterNode)

		if (Object.keys(attrsChanged).length > 0 || Object.keys(relsChanged).length > 0) {
			nodeChanges.push({
				nodeId,
				modelName: afterNode.modelName,
				attrsChanged,
				relsChanged,
			})
		}
	}

	return {
		addedNodes,
		removedNodes,
		nodeChanges,
		summary: {
			addedCount: addedNodes.length,
			removedCount: removedNodes.length,
			changedCount: nodeChanges.length,
			totalNodesBefore: beforeMap.size,
			totalNodesAfter: afterMap.size,
		},
	}
}
