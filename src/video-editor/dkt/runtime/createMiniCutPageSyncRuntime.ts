import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { ReactSyncReceiver } from '../../../dkt-react-sync/receiver/ReactSyncReceiver'
import { createSyncStore } from '../../../dkt-react-sync/runtime/createSyncStore'
import type { PageSyncRuntime } from '../../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../../dkt-react-sync/scope/ScopeHandle'
import {
  type ReactTransportShape,
  ShapeRegistry,
  type ShapeRegistryRuntime,
} from '../../../dkt-react-sync/shape/ShapeRegistry'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'
import {
  createBootstrapMessage,
  createCloseSessionMessage,
  createDispatchActionMessage,
  createSyncRequireShapeMessage,
  createSyncUpdateStructureUsageMessage,
} from './scopedActionTransport'
import {
  createEmptyPageRuntimeSnapshot,
  createPageRuntimeSnapshotWithVersion,
  shouldResetPageRuntimeForBootstrap,
} from './pageRuntimeStore'

type RootAttrsCacheEntry = {
  rootNodeId: string | null
  values: Record<string, unknown>
}

export const createMiniCutPageSyncRuntime = ({
  transport,
}: {
  transport: DomSyncTransportLike<MiniCutDktTransportMessage>
}): PageSyncRuntime => {
  const store = createSyncStore(createEmptyPageRuntimeSnapshot())
  const rootAttrsCache = new Map<string, RootAttrsCacheEntry>()
  const debugMessageLog: unknown[] = []
  let pendingDumpResolve: ((result: unknown) => void) | null = null

  const pushDebugMessage = (direction: 'in' | 'out', message: unknown) => {
    debugMessageLog.push({
      at: new Date().toISOString(),
      direction,
      message,
    })

    if (debugMessageLog.length > 100) {
      debugMessageLog.splice(0, debugMessageLog.length - 100)
    }
  }

  const emit = (message: MiniCutDktTransportMessage) => {
    pushDebugMessage('out', message)
    transport.send(message)
  }

  const syncReceiver = new ReactSyncReceiver({
    RPCLegacy() {},
    updateStructureUsage(data) {
      emit(createSyncUpdateStructureUsageMessage(data))
    },
    requireShapeForModel(data) {
      emit(createSyncRequireShapeMessage(data))
    },
  })
  const shapeRegistry = new ShapeRegistry()

  const shapeRuntime: ShapeRegistryRuntime = {
    publishShapeGraph(graph: Record<string, ReactTransportShape>) {
      syncReceiver.updateStructureUsage({ graph })
    },
    requireNodeShapes(nodeId: string, shapeIds: readonly string[]) {
      syncReceiver.requireShapeForModel([nodeId, ...shapeIds])
    },
    readOne(scope: ReactSyncScopeHandle, relName: string) {
      return syncReceiver.readOneScope(scope, relName)
    },
    subscribeOne(scope: ReactSyncScopeHandle, relName: string, listener: () => void) {
      return syncReceiver.subscribeNodeRel(scope._nodeId, relName, listener)
    },
    readMany(scope: ReactSyncScopeHandle, relName: string) {
      return syncReceiver.readManyScopes(scope, relName)
    },
    subscribeMany(scope: ReactSyncScopeHandle, relName: string, listener: () => void) {
      return syncReceiver.subscribeNodeList(scope._nodeId, relName, listener)
    },
  }

  const syncSnapshotWithReceiver = () => {
    const current = store.getSnapshot()
    const rootNodeId = syncReceiver.getRootNodeId()
    const ready = Boolean(current.booted && rootNodeId)

    if (current.rootNodeId === rootNodeId && current.ready === ready) {
      return
    }

    store.setSnapshot(
      createPageRuntimeSnapshotWithVersion(current, {
        rootNodeId,
        ready,
      }),
    )
  }

  const getRootAttrs = (attrNames: readonly string[]) => {
    const rootNodeId = syncReceiver.getRootNodeId()
    const cacheKey = attrNames.join('\u001f')
    const nextValues = syncReceiver.readRootAttrs(attrNames)
    const cached = rootAttrsCache.get(cacheKey)

    if (cached && cached.rootNodeId === rootNodeId) {
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

    rootAttrsCache.set(cacheKey, {
      rootNodeId,
      values: nextValues,
    })

    return nextValues
  }

  const bootstrap = (options?: {
    sessionId?: string | null
    sessionKey?: string | null
    route?: unknown
  }) => {
    const current = store.getSnapshot()

    if (shouldResetPageRuntimeForBootstrap(current, options)) {
      syncReceiver.resetGraph()
      shapeRegistry.destroy()
      rootAttrsCache.clear()
      store.setSnapshot(
        createPageRuntimeSnapshotWithVersion(current, {
          booted: false,
          ready: false,
          rootNodeId: null,
          sessionId: null,
          sessionKey: options?.sessionKey ?? null,
        }),
      )
    }

    emit(
      createBootstrapMessage({
        sessionKey: options?.sessionKey,
        ...(options && 'route' in options ? { route: options.route } : {}),
      }),
    )
  }

  const dispatchAction = (
    actionName: string,
    payload?: unknown,
    scope?: ReactSyncScopeHandle | null,
  ) => {
    if (!actionName) {
      throw new Error('action name is required')
    }

    emit(createDispatchActionMessage(actionName, payload, scope?._nodeId ?? null))
  }

  const scopeDispatchCache = new WeakMap<
    ReactSyncScopeHandle,
    (actionName: string, payload?: unknown) => void
  >()

  const getDispatch = (
    scope: ReactSyncScopeHandle | null,
  ): ((actionName: string, payload?: unknown) => void) => {
    if (!scope) {
      return (actionName, payload) => dispatchAction(actionName, payload, null)
    }

    let cached = scopeDispatchCache.get(scope)
    if (!cached) {
      cached = (actionName: string, payload?: unknown) => dispatchAction(actionName, payload, scope)
      scopeDispatchCache.set(scope, cached)
    }

    return cached
  }

  const handleSyncMessage = (
    message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>,
  ) => {
    switch (message.syncType) {
      case SYNCR_TYPES.SET_DICT:
      case SYNCR_TYPES.SET_MODEL_SCHEMA:
      case SYNCR_TYPES.UPDATE:
      case SYNCR_TYPES.TREE_ROOT: {
        syncReceiver.handleSync(message.syncType, message.payload)
        syncSnapshotWithReceiver()
        return
      }
    }
  }

  const handleMessage = (message: MiniCutDktTransportMessage) => {
    switch (message.type) {
      case DKT_MSG.RUNTIME_READY: {
        const current = store.getSnapshot()
        store.setSnapshot(
          createPageRuntimeSnapshotWithVersion(current, {
            booted: true,
            sessionKey: message.sessionKey ?? current.sessionKey,
            rootNodeId: message.rootNodeId ?? syncReceiver.getRootNodeId(),
            ready: Boolean(message.rootNodeId ?? syncReceiver.getRootNodeId()),
          }),
        )
        return
      }
      case DKT_MSG.RUNTIME_LOG:
      {
        console.info('[minicut:dkt-runtime]', message.message)
        return
      }
      case DKT_MSG.RUNTIME_ERROR: {
        console.error('[minicut:dkt-runtime:error]', message.message)
        return
      }
      case DKT_MSG.SYNC_HANDLE: {
        handleSyncMessage(message)
        return
      }
      case DKT_MSG.P2P_SESSION_LOST: {
        const current = store.getSnapshot()
        const sessionKey = current.sessionKey
        syncReceiver.resetGraph()
        shapeRegistry.destroy()
        rootAttrsCache.clear()
        store.setSnapshot(
          createPageRuntimeSnapshotWithVersion(current, {
            booted: false,
            ready: false,
            rootNodeId: null,
            sessionId: null,
          }),
        )
        emit(createBootstrapMessage({ sessionKey }))
        return
      }
      case DKT_MSG.DEBUG_DUMP_RESPONSE: {
        pendingDumpResolve?.(message.dump)
        pendingDumpResolve = null
        return
      }
    }
  }

  const unlisten = transport.listen((message) => {
    pushDebugMessage('in', message)
    Promise.resolve(handleMessage(message)).catch(() => undefined)
  })

  return {
    store,
    bootstrap,
    debugDescribeNode: (nodeId) => syncReceiver.debugDescribeNode(nodeId),
    debugDumpGraph: () => syncReceiver.debugDumpGraph(),
    debugMessages: () => debugMessageLog.slice(),
    requestDebugDump: () => new Promise<unknown>((resolve) => {
      pendingDumpResolve = resolve
      emit({ type: DKT_MSG.DEBUG_DUMP_REQUEST })
    }),
    dispatchAction,
    getSnapshot: () => store.getSnapshot(),
    getRootScope: () => syncReceiver.getRootScope(),
    subscribeRootScope: (listener) => syncReceiver.subscribeRoot(listener),
    readAttrs: (scope, attrNames) => syncReceiver.readScopeAttrs(scope, attrNames),
    subscribeAttrs: (scope, attrNames, listener) =>
      syncReceiver.subscribeNodeAttrs(scope._nodeId, attrNames, listener),
    readOne: (scope, relName) => syncReceiver.readOneScope(scope, relName),
    subscribeOne: (scope, relName, listener) =>
      syncReceiver.subscribeNodeRel(scope._nodeId, relName, listener),
    readMany: (scope, relName) => syncReceiver.readManyScopes(scope, relName),
    subscribeMany: (scope, relName, listener) =>
      syncReceiver.subscribeNodeList(scope._nodeId, relName, listener),
    mountShape: (scope, shape) => shapeRegistry.mount(shapeRuntime, scope, shape),
    dispatch: (actionName, payload, scope) => {
      dispatchAction(actionName, payload, scope)
    },
    getDispatch,
    getRootAttrs,
    subscribe: store.subscribe,
    subscribeRootAttrs: (attrNames, listener) =>
      syncReceiver.subscribeRootAttrs(attrNames, listener),
    destroy() {
      const sessionKey = store.getSnapshot().sessionKey
      if (sessionKey) {
        emit(createCloseSessionMessage())
      }
      unlisten?.()
      transport.destroy()
      syncReceiver.destroy()
      shapeRegistry.destroy()
      rootAttrsCache.clear()
    },
  }
}