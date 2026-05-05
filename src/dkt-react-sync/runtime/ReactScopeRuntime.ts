import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'
import type { DefinedReactShape } from '../shape/defineShape'

export interface ReactScopeRuntime {
  getRootScope(): ReactSyncScopeHandle | null
  subscribeRootScope(listener: () => void): () => void

  readAttrs(scope: ReactSyncScopeHandle, attrNames: readonly string[]): Record<string, unknown>
  subscribeAttrs(
    scope: ReactSyncScopeHandle,
    attrNames: readonly string[],
    listener: () => void,
  ): () => void

  readOne(scope: ReactSyncScopeHandle, relName: string): ReactSyncScopeHandle | null
  subscribeOne(scope: ReactSyncScopeHandle, relName: string, listener: () => void): () => void

  readMany(scope: ReactSyncScopeHandle, relName: string): readonly ReactSyncScopeHandle[]
  subscribeMany(scope: ReactSyncScopeHandle, relName: string, listener: () => void): () => void

  mountShape(scope: ReactSyncScopeHandle, shape: DefinedReactShape): () => void

  dispatch(actionName: string, payload?: unknown, scope?: ReactSyncScopeHandle | null): void

  getDispatch(scope: ReactSyncScopeHandle | null): (actionName: string, payload?: unknown) => void
}