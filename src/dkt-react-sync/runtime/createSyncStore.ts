export interface SyncStore<TSnapshot> {
  getSnapshot(): TSnapshot
  subscribe(listener: () => void): () => void
  setSnapshot(nextSnapshot: TSnapshot): void
  updateSnapshot(updater: (currentSnapshot: TSnapshot) => TSnapshot): void
}

export const createSyncStore = <TSnapshot>(initialSnapshot: TSnapshot): SyncStore<TSnapshot> => {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getSnapshot() {
      return snapshot
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSnapshot(nextSnapshot: TSnapshot) {
      snapshot = nextSnapshot
      notify()
    },
    updateSnapshot(updater: (currentSnapshot: TSnapshot) => TSnapshot) {
      snapshot = updater(snapshot)
      notify()
    },
  }
}