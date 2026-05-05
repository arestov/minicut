import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'

type DictKey = number | string
type Listener = () => void
type NodeRef = string
type RelValue = NodeRef | NodeRef[] | null

export type ReactSyncDebugNode = {
  nodeId: string
  modelName: string | null
  hierarchyNum: number | null
  constrId: number | string | null
  attrsVersion: number
  relsVersion: number
  attrs: Record<string, unknown>
  rels: Record<string, RelValue>
}

export type ReactSyncDebugGraph = {
  rootNodeId: string | null
  dict: readonly (string | undefined)[] | null
  modelSchema: unknown | null
  nodes: ReactSyncDebugNode[]
}

/*
  tmp/dkt currently does not export SyncR_U_TYPES.js and SyncR_cursor.js correctly.
  Keep the compact protocol cursor constants local here until DKT build is fixed.
*/
const SYRU_UPDATE_ATTRS = 0
const SYRU_UPDATE_RELS = 1
const R_UPDATE_TREE_BASE = 3
const R_UPDATE_TREE_ATTRS = 4
const R_UPDATE_TREE_RELS = 5
const R_UPDATE_TREE_COMPLETE = 6

const SYNC_BATCH_TYPE = 0

const SYNC_ATTRS_NODE_ID = 1
const SYNC_ATTRS_CHANGES_LENGTH = 2
const SYNC_ATTRS_PAYLOAD = 3

const SYNC_REL_NODE_ID = 1
const SYNC_REL_KEYWORD = 2
const SYNC_REL_VALUE = 3
const SYNC_REL_LENGTH = 4

const SYNC_TREE_BASE_NODE_ID = 1
const SYNC_TREE_BASE_MODEL_NAME = 2
const SYNC_TREE_BASE_HIERARCHY_NUM = 3
const SYNC_TREE_BASE_CONSTR_ID = 4
const SYNC_TREE_BASE_LENGTH = 5

const SYNC_TREE_ATTRS_NODE_ID = 1
const SYNC_TREE_ATTRS_DATA = 2
const SYNC_TREE_ATTRS_LENGTH = 3

const SYNC_TREE_REL_NODE_ID = 1
const SYNC_TREE_REL_KEYWORD = 2
const SYNC_TREE_REL_VALUE = 3
const SYNC_TREE_REL_LENGTH = 4

const SYNC_TREE_COMPLETE_LENGTH = 1

export interface ReactSyncBridge {
  RPCLegacy(nodeId: string, args: unknown[]): void
  updateStructureUsage(data: unknown): void
  requireShapeForModel(data: unknown): void
}

export interface ReactSyncNode {
  nodeId: string
  modelNameKey: DictKey | null
  hierarchyNum: number | null
  constrId: number | string | null
  attrs: Map<DictKey, unknown>
  rels: Map<DictKey, RelValue>
  attrsVersion: number
  relsVersion: number
}

const EMPTY_OBJECT = Object.freeze({}) as Record<string, unknown>
const noop = () => {}

const toNodeId = (value: unknown): string => `${value}`

const normalizeRelValue = (value: unknown): RelValue => {
  if (value == null) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map((item) => toNodeId(item))
  }

  return toNodeId(value)
}

const sameRelValue = (left: RelValue, right: RelValue) => {
  if (left === right) {
    return true
  }

  if (left == null || right == null) {
    return false
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false
    }

    if (left.length !== right.length) {
      return false
    }

    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false
      }
    }

    return true
  }

  return false
}

const notifyAll = (listeners: Iterable<Listener>) => {
  for (const listener of listeners) {
    listener()
  }
}

export class ReactSyncReceiver {
  private bridge: ReactSyncBridge | null

  private rootNodeId: string | null

  private dictFlat: readonly (string | undefined)[] | null

  private dictNumsByName: Map<string, number>

  private modelSchema: unknown | null

  private nodesById: Map<string, ReactSyncNode>

  private scopesByNodeId: Map<string, ReactSyncScopeHandle>

  private rootSubs: Set<Listener>

  private attrSubsByNodeId: Map<string, Map<string, Set<Listener>>>

  private relSubsByNodeId: Map<string, Map<string, Set<Listener>>>

  private listSubsByNodeId: Map<string, Map<string, Set<Listener>>>

  private attrsReadCache: Map<string, { nodeId: string | null; values: Record<string, unknown> }>

  private manyReadCache: Map<
    string,
    {
      relValue: RelValue
      scopes: readonly ReactSyncScopeHandle[]
    }
  >

  constructor(bridge: ReactSyncBridge | null) {
    this.bridge = bridge
    this.rootNodeId = null
    this.dictFlat = null
    this.dictNumsByName = new Map()
    this.modelSchema = null
    this.nodesById = new Map()
    this.scopesByNodeId = new Map()
    this.rootSubs = new Set()
    this.attrSubsByNodeId = new Map()
    this.relSubsByNodeId = new Map()
    this.listSubsByNodeId = new Map()
    this.attrsReadCache = new Map()
    this.manyReadCache = new Map()
  }

  getRootNodeId() {
    return this.rootNodeId
  }

  getScope(nodeId: string | null) {
    if (!nodeId) {
      return null
    }

    let scope = this.scopesByNodeId.get(nodeId)
    if (!scope) {
      scope = Object.freeze({
        kind: 'scope' as const,
        _nodeId: nodeId,
      })
      this.scopesByNodeId.set(nodeId, scope)
    }

    return scope
  }

  getRootScope() {
    return this.getScope(this.rootNodeId)
  }

  getModelSchema() {
    return this.modelSchema
  }

  getNode(nodeId: string) {
    return this.nodesById.get(nodeId) || null
  }

  getModelName(nodeId: string) {
    const node = this.nodesById.get(nodeId)
    if (!node || node.modelNameKey == null) {
      return null
    }

    return this.resolveName(node.modelNameKey)
  }

  debugDescribeNode(nodeId: string): ReactSyncDebugNode | null {
    const node = this.nodesById.get(nodeId)
    if (!node) {
      return null
    }

    const attrs: Record<string, unknown> = {}
    const rels: Record<string, RelValue> = {}

    for (const [key, value] of node.attrs) {
      const name = this.resolveName(key) ?? `${key}`
      attrs[name] = value
    }

    for (const [key, value] of node.rels) {
      const name = this.resolveName(key) ?? `${key}`
      rels[name] = value
    }

    return {
      nodeId: node.nodeId,
      modelName: node.modelNameKey == null ? null : this.resolveName(node.modelNameKey),
      hierarchyNum: node.hierarchyNum,
      constrId: node.constrId,
      attrsVersion: node.attrsVersion,
      relsVersion: node.relsVersion,
      attrs,
      rels,
    }
  }

  debugDumpGraph(): ReactSyncDebugGraph {
    const nodes = Array.from(this.nodesById.keys())
      .sort()
      .map((nodeId) => this.debugDescribeNode(nodeId))
      .filter((item): item is ReactSyncDebugNode => item != null)

    return {
      rootNodeId: this.rootNodeId,
      dict: this.dictFlat,
      modelSchema: this.modelSchema,
      nodes,
    }
  }

  readRootAttrs(attrNames: readonly string[]) {
    return this.readAttrs(this.rootNodeId, attrNames)
  }

  readScopeAttrs(scope: ReactSyncScopeHandle, attrNames: readonly string[]) {
    return this.readAttrs(scope._nodeId, attrNames)
  }

  readRel(nodeId: string | null, relName: string): RelValue {
    if (!nodeId) {
      return null
    }

    const node = this.nodesById.get(nodeId)
    if (!node) {
      return null
    }

    return this.readRelFromNode(node, relName)
  }

  readRootRel(relName: string) {
    return this.readRel(this.rootNodeId, relName)
  }

  readOneScope(scope: ReactSyncScopeHandle, relName: string) {
    const value = this.readRel(scope._nodeId, relName)

    if (value == null) {
      return null
    }

    if (Array.isArray(value)) {
      throw new Error(`rel ${relName} is many, expected one`)
    }

    return this.getScope(value)
  }

  readManyScopes(scope: ReactSyncScopeHandle, relName: string) {
    // React 19 requires useSyncExternalStore snapshots to keep identity when
    // data is unchanged. This cache is the stability boundary used by hooks and
    // components; do not replace it with array cloning in hook code.
    const cacheKey = `${scope._nodeId}\u001f${relName}`
    const relValue = this.readRel(scope._nodeId, relName)
    const cached = this.manyReadCache.get(cacheKey)

    if (relValue == null) {
      if (cached && cached.relValue == null) {
        return cached.scopes
      }

      const nextScopes = Object.freeze([]) as readonly ReactSyncScopeHandle[]
      this.manyReadCache.set(cacheKey, {
        relValue: null,
        scopes: nextScopes,
      })
      return nextScopes
    }

    if (!Array.isArray(relValue)) {
      throw new Error(`rel ${relName} is one, expected many`)
    }

    if (cached && cached.relValue === relValue) {
      return cached.scopes
    }

    const nextScopes = Object.freeze(
      relValue
        .map((nodeId) => this.getScope(nodeId))
        .filter((item): item is ReactSyncScopeHandle => item != null),
    )

    this.manyReadCache.set(cacheKey, {
      relValue,
      scopes: nextScopes,
    })

    return nextScopes
  }

  subscribeRoot(listener: Listener) {
    this.rootSubs.add(listener)
    return () => {
      this.rootSubs.delete(listener)
    }
  }

  subscribeNodeAttrs(nodeId: string | null, attrNames: readonly string[], listener: Listener) {
    if (!nodeId) {
      return noop
    }

    const nodeStore = this.ensureNodeNamedSubs(this.attrSubsByNodeId, nodeId)
    const cleanups: Array<() => void> = []

    for (let i = 0; i < attrNames.length; i += 1) {
      const attrName = attrNames[i]
      const listeners = this.ensureNamedListenerBucket(nodeStore, attrName)
      listeners.add(listener)
      cleanups.push(() => {
        listeners.delete(listener)
        if (!listeners.size) {
          nodeStore.delete(attrName)
        }
      })
    }

    return () => {
      for (let i = 0; i < cleanups.length; i += 1) {
        cleanups[i]()
      }
      if (!nodeStore.size) {
        this.attrSubsByNodeId.delete(nodeId)
      }
    }
  }

  subscribeRootAttrs(attrNames: readonly string[], listener: Listener) {
    let currentRootNodeId = this.rootNodeId
    let stopAttrs = this.subscribeNodeAttrs(currentRootNodeId, attrNames, listener)

    const stopRoot = this.subscribeRoot(() => {
      const nextRootNodeId = this.rootNodeId
      if (nextRootNodeId !== currentRootNodeId) {
        stopAttrs()
        currentRootNodeId = nextRootNodeId
        stopAttrs = this.subscribeNodeAttrs(currentRootNodeId, attrNames, listener)
      }

      listener()
    })

    return () => {
      stopRoot()
      stopAttrs()
    }
  }

  subscribeNodeRel(nodeId: string | null, relName: string, listener: Listener) {
    if (!nodeId) {
      return noop
    }

    return this.subscribeNamed(this.relSubsByNodeId, nodeId, relName, listener)
  }

  subscribeNodeList(nodeId: string | null, relName: string, listener: Listener) {
    if (!nodeId) {
      return noop
    }

    return this.subscribeNamed(this.listSubsByNodeId, nodeId, relName, listener)
  }

  subscribeRootRel(relName: string, listener: Listener) {
    let currentRootNodeId = this.rootNodeId
    let stopRel = this.subscribeNodeRel(currentRootNodeId, relName, listener)

    const stopRoot = this.subscribeRoot(() => {
      const nextRootNodeId = this.rootNodeId
      if (nextRootNodeId !== currentRootNodeId) {
        stopRel()
        currentRootNodeId = nextRootNodeId
        stopRel = this.subscribeNodeRel(currentRootNodeId, relName, listener)
      }

      listener()
    })

    return () => {
      stopRoot()
      stopRel()
    }
  }

  subscribeRootList(relName: string, listener: Listener) {
    let currentRootNodeId = this.rootNodeId
    let stopList = this.subscribeNodeList(currentRootNodeId, relName, listener)

    const stopRoot = this.subscribeRoot(() => {
      const nextRootNodeId = this.rootNodeId
      if (nextRootNodeId !== currentRootNodeId) {
        stopList()
        currentRootNodeId = nextRootNodeId
        stopList = this.subscribeNodeList(currentRootNodeId, relName, listener)
      }

      listener()
    })

    return () => {
      stopRoot()
      stopList()
    }
  }

  RPCLegacy(nodeId: string, args: unknown[]) {
    this.bridge?.RPCLegacy(nodeId, args)
  }

  updateStructureUsage(data: unknown) {
    this.bridge?.updateStructureUsage(data)
  }

  requireShapeForModel(data: unknown) {
    this.bridge?.requireShapeForModel(data)
  }

  handleSync(syncType: number, payload: unknown) {
    switch (syncType) {
      case SYNCR_TYPES.SET_DICT: {
        this.setDict(payload as readonly (string | undefined)[] | null)
        return
      }
      case SYNCR_TYPES.SET_MODEL_SCHEMA: {
        this.modelSchema = payload
        return
      }
      case SYNCR_TYPES.TREE_ROOT: {
        this.handleTreeRoot(
          payload as {
            node_id?: string | number | null
            data?: readonly [DictKey, number | null, number | string | null]
          },
        )
        return
      }
      case SYNCR_TYPES.UPDATE: {
        this.handleUpdate(payload as readonly unknown[])
        return
      }
    }
  }

  destroy() {
    this.bridge = null
    this.rootNodeId = null
    this.dictFlat = null
    this.dictNumsByName.clear()
    this.modelSchema = null
    this.nodesById.clear()
    this.scopesByNodeId.clear()
    this.rootSubs.clear()
    this.attrSubsByNodeId.clear()
    this.relSubsByNodeId.clear()
    this.listSubsByNodeId.clear()
    this.attrsReadCache.clear()
    this.manyReadCache.clear()
  }

  resetGraph() {
    const previousRootNodeId = this.rootNodeId

    this.rootNodeId = null
    this.dictFlat = null
    this.dictNumsByName.clear()
    this.modelSchema = null
    this.nodesById.clear()
    this.scopesByNodeId.clear()
    this.attrsReadCache.clear()
    this.manyReadCache.clear()

    if (previousRootNodeId != null) {
      notifyAll(this.rootSubs)
    }
  }

  private handleTreeRoot(payload: {
    node_id?: string | number | null
    data?: readonly [DictKey, number | null, number | string | null]
  }) {
    const nextRootNodeId = payload?.node_id == null ? null : toNodeId(payload.node_id)
    const previousRootNodeId = this.rootNodeId

    if (nextRootNodeId) {
      this.ensureNode(
        nextRootNodeId,
        payload?.data?.[0] ?? null,
        payload?.data?.[1] ?? null,
        payload?.data?.[2] ?? null,
      )
    }

    this.rootNodeId = nextRootNodeId
    this.attrsReadCache.clear()
    this.manyReadCache.clear()

    if (previousRootNodeId !== nextRootNodeId) {
      notifyAll(this.rootSubs)
    }
  }

  private handleUpdate(list: readonly unknown[]) {
    const dirtyAttrsByNodeId = new Map<string, Set<string>>()
    const dirtyRelsByNodeId = new Map<string, Set<string>>()
    const dirtyListsByNodeId = new Map<string, Set<string>>()
    let cursor = 0

    while (cursor < list.length) {
      const changeType = list[cursor + SYNC_BATCH_TYPE]

      switch (changeType) {
        case SYRU_UPDATE_ATTRS: {
          const nodeId = toNodeId(list[cursor + SYNC_ATTRS_NODE_ID])
          const changesLength = Number(list[cursor + SYNC_ATTRS_CHANGES_LENGTH] ?? 0)
          const start = cursor + SYNC_ATTRS_PAYLOAD
          this.applyAttrsFlat(nodeId, list.slice(start, start + changesLength), dirtyAttrsByNodeId)
          cursor = start + changesLength
          break
        }
        case SYRU_UPDATE_RELS: {
          const nodeId = toNodeId(list[cursor + SYNC_REL_NODE_ID])
          this.applyRel(
            nodeId,
            list[cursor + SYNC_REL_KEYWORD] as DictKey,
            list[cursor + SYNC_REL_VALUE],
            dirtyRelsByNodeId,
            dirtyListsByNodeId,
          )
          cursor += SYNC_REL_LENGTH
          break
        }
        case R_UPDATE_TREE_BASE: {
          const nodeId = toNodeId(list[cursor + SYNC_TREE_BASE_NODE_ID])
          this.ensureNode(
            nodeId,
            (list[cursor + SYNC_TREE_BASE_MODEL_NAME] as DictKey) ?? null,
            (list[cursor + SYNC_TREE_BASE_HIERARCHY_NUM] as number | null) ?? null,
            (list[cursor + SYNC_TREE_BASE_CONSTR_ID] as number | string | null) ?? null,
          )
          cursor += SYNC_TREE_BASE_LENGTH
          break
        }
        case R_UPDATE_TREE_ATTRS: {
          const nodeId = toNodeId(list[cursor + SYNC_TREE_ATTRS_NODE_ID])
          this.applyAttrsFlat(
            nodeId,
            list[cursor + SYNC_TREE_ATTRS_DATA] as readonly unknown[],
            dirtyAttrsByNodeId,
          )
          cursor += SYNC_TREE_ATTRS_LENGTH
          break
        }
        case R_UPDATE_TREE_RELS: {
          const nodeId = toNodeId(list[cursor + SYNC_TREE_REL_NODE_ID])
          this.applyRel(
            nodeId,
            list[cursor + SYNC_TREE_REL_KEYWORD] as DictKey,
            list[cursor + SYNC_TREE_REL_VALUE],
            dirtyRelsByNodeId,
            dirtyListsByNodeId,
          )
          cursor += SYNC_TREE_REL_LENGTH
          break
        }
        case R_UPDATE_TREE_COMPLETE: {
          cursor += SYNC_TREE_COMPLETE_LENGTH
          break
        }
        default: {
          throw new Error(`unknown sync update chunk type: ${String(changeType)}`)
        }
      }
    }

    this.flushDirtyNamed(this.attrSubsByNodeId, dirtyAttrsByNodeId)
    this.flushDirtyNamed(this.relSubsByNodeId, dirtyRelsByNodeId)
    this.flushDirtyNamed(this.listSubsByNodeId, dirtyListsByNodeId)
  }

  private setDict(dictFlat: readonly (string | undefined)[] | null) {
    this.dictFlat = dictFlat
    this.dictNumsByName.clear()
    this.attrsReadCache.clear()
    this.manyReadCache.clear()

    if (dictFlat) {
      for (let i = 0; i < dictFlat.length; i += 1) {
        const keyword = dictFlat[i]
        if (!keyword) {
          continue
        }

        this.dictNumsByName.set(keyword, i)
      }
    }

    this.flushAllNamed(this.attrSubsByNodeId)
    this.flushAllNamed(this.relSubsByNodeId)
    this.flushAllNamed(this.listSubsByNodeId)
  }

  private ensureNode(
    nodeId: string,
    modelNameKey: DictKey | null,
    hierarchyNum: number | null,
    constrId: number | string | null,
  ) {
    const existing = this.nodesById.get(nodeId)
    if (existing) {
      if (modelNameKey != null) {
        existing.modelNameKey = modelNameKey
      }
      if (hierarchyNum != null) {
        existing.hierarchyNum = hierarchyNum
      }
      if (constrId != null) {
        existing.constrId = constrId
      }
      return existing
    }

    const node: ReactSyncNode = {
      nodeId,
      modelNameKey,
      hierarchyNum,
      constrId,
      attrs: new Map(),
      rels: new Map(),
      attrsVersion: 0,
      relsVersion: 0,
    }
    this.nodesById.set(nodeId, node)
    return node
  }

  private applyAttrsFlat(
    nodeId: string,
    attrsFlat: readonly unknown[],
    dirtyAttrsByNodeId: Map<string, Set<string>>,
  ) {
    const node = this.ensureNode(nodeId, null, null, null)
    let changed = false

    for (let i = 0; i < attrsFlat.length; i += 2) {
      const attrKey = attrsFlat[i] as DictKey
      const attrValue = attrsFlat[i + 1]
      const previous = node.attrs.get(attrKey)

      if (Object.is(previous, attrValue)) {
        continue
      }

      node.attrs.set(attrKey, attrValue)
      changed = true

      const attrName = this.resolveName(attrKey)
      if (attrName) {
        this.pushDirtyName(dirtyAttrsByNodeId, nodeId, attrName)
      }
    }

    if (changed) {
      node.attrsVersion += 1
    }
  }

  private applyRel(
    nodeId: string,
    relKey: DictKey,
    value: unknown,
    dirtyRelsByNodeId: Map<string, Set<string>>,
    dirtyListsByNodeId: Map<string, Set<string>>,
  ) {
    const node = this.ensureNode(nodeId, null, null, null)
    const nextValue = normalizeRelValue(value)
    const previous = (node.rels.get(relKey) ?? null) as RelValue

    if (sameRelValue(previous, nextValue)) {
      return
    }

    node.rels.set(relKey, nextValue)
    node.relsVersion += 1

    const relName = this.resolveName(relKey)
    if (!relName) {
      return
    }

    this.pushDirtyName(dirtyRelsByNodeId, nodeId, relName)
    this.pushDirtyName(dirtyListsByNodeId, nodeId, relName)

    if (nextValue == null) {
      return
    }

    if (Array.isArray(nextValue)) {
      for (let i = 0; i < nextValue.length; i += 1) {
        this.ensureNode(nextValue[i], null, null, null)
      }
      return
    }

    this.ensureNode(nextValue, null, null, null)
  }

  private flushDirtyNamed(
    store: Map<string, Map<string, Set<Listener>>>,
    dirtyByNodeId: Map<string, Set<string>>,
  ) {
    const listenersToNotify = new Set<Listener>()

    for (const [nodeId, dirtyNames] of dirtyByNodeId) {
      const nodeStore = store.get(nodeId)
      if (!nodeStore) {
        continue
      }

      for (const name of dirtyNames) {
        const listeners = nodeStore.get(name)
        if (!listeners) {
          continue
        }

        for (const listener of listeners) {
          listenersToNotify.add(listener)
        }
      }
    }

    notifyAll(listenersToNotify)
  }

  private flushAllNamed(store: Map<string, Map<string, Set<Listener>>>) {
    const listenersToNotify = new Set<Listener>()

    for (const nodeStore of store.values()) {
      for (const listeners of nodeStore.values()) {
        for (const listener of listeners) {
          listenersToNotify.add(listener)
        }
      }
    }

    notifyAll(listenersToNotify)
  }

  private pushDirtyName(dirtyByNodeId: Map<string, Set<string>>, nodeId: string, name: string) {
    let nodeDirty = dirtyByNodeId.get(nodeId)
    if (!nodeDirty) {
      nodeDirty = new Set()
      dirtyByNodeId.set(nodeId, nodeDirty)
    }

    nodeDirty.add(name)
  }

  private readAttrFromNode(node: ReactSyncNode, attrName: string) {
    const dictNum = this.dictNumsByName.get(attrName)

    if (dictNum != null && node.attrs.has(dictNum)) {
      return node.attrs.get(dictNum)
    }

    return node.attrs.get(attrName)
  }

  private readRelFromNode(node: ReactSyncNode, relName: string): RelValue {
    const dictNum = this.dictNumsByName.get(relName)

    if (dictNum != null && node.rels.has(dictNum)) {
      return (node.rels.get(dictNum) ?? null) as RelValue
    }

    return (node.rels.get(relName) ?? null) as RelValue
  }

  private resolveName(key: DictKey) {
    if (typeof key === 'string') {
      return key
    }

    return this.dictFlat?.[key] ?? null
  }

  private ensureNodeNamedSubs(store: Map<string, Map<string, Set<Listener>>>, nodeId: string) {
    let nodeStore = store.get(nodeId)
    if (!nodeStore) {
      nodeStore = new Map()
      store.set(nodeId, nodeStore)
    }

    return nodeStore
  }

  private ensureNamedListenerBucket(store: Map<string, Set<Listener>>, name: string) {
    let listeners = store.get(name)
    if (!listeners) {
      listeners = new Set()
      store.set(name, listeners)
    }

    return listeners
  }

  private subscribeNamed(
    store: Map<string, Map<string, Set<Listener>>>,
    nodeId: string,
    name: string,
    listener: Listener,
  ) {
    const nodeStore = this.ensureNodeNamedSubs(store, nodeId)
    const listeners = this.ensureNamedListenerBucket(nodeStore, name)
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        nodeStore.delete(name)
      }
      if (!nodeStore.size) {
        store.delete(nodeId)
      }
    }
  }

  readAttrs(nodeId: string | null, attrNames: readonly string[]) {
    if (!nodeId) {
      return EMPTY_OBJECT
    }

    const node = this.nodesById.get(nodeId)
    if (!node) {
      return EMPTY_OBJECT
    }

    const cacheKey = `${nodeId}\u001f${attrNames.join('\u001f')}`
    const nextValues: Record<string, unknown> = {}

    for (let i = 0; i < attrNames.length; i += 1) {
      const name = attrNames[i]
      nextValues[name] = this.readAttrFromNode(node, name)
    }

    // Same external-store contract as readManyScopes: callers must receive the
    // previous object when requested attrs did not change.
    const cached = this.attrsReadCache.get(cacheKey)
    if (cached && cached.nodeId === nodeId) {
      let changed = false

      for (let i = 0; i < attrNames.length; i += 1) {
        const name = attrNames[i]
        if (!Object.is(cached.values[name], nextValues[name])) {
          changed = true
          break
        }
      }

      if (!changed) {
        return cached.values
      }
    }

    this.attrsReadCache.set(cacheKey, {
      nodeId,
      values: nextValues,
    })

    return nextValues
  }
}