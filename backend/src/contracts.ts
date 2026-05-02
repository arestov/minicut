export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean | void>
  getAlarm?(): Promise<number | null>
  setAlarm?(scheduledTime: number): Promise<void>
  deleteAlarm?(): Promise<void>
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>
  acceptWebSocket?(ws: WebSocket, tags?: string[]): void
  getWebSockets?(tag?: string): WebSocket[]
}

export interface DurableObjectIdLike {
  toString(): string
}

export interface DurableObjectStubLike {
  fetch(request: Request | string): Promise<Response>
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike | string
  get(id: DurableObjectIdLike | string): DurableObjectStubLike
}

export interface WorkerEnv {
  SIGNALING_ROOM: DurableObjectNamespaceLike
}
