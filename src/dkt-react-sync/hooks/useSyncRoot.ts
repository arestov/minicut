import { useSyncExternalStore } from 'react'
import type { PageSyncRuntime } from '../runtime/PageSyncRuntime'

export const useSyncRoot = (runtime: PageSyncRuntime) =>
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)