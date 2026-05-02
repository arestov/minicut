import type {
  DurableObjectNamespaceLike,
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from '../src/contracts'

type DurableObjectInstance = {
  fetch(request: Request): Promise<Response>
}

export class MemoryStorage implements DurableObjectStorageLike {
  private readonly values = new Map<string, unknown>()
  private alarmAt: number | null = null

  async get<T = unknown>(key: string) {
    return this.values.get(key) as T | undefined
  }

  async put<T = unknown>(key: string, value: T) {
    this.values.set(key, value)
  }

  async delete(key: string) {
    return this.values.delete(key)
  }

  async getAlarm() {
    return this.alarmAt
  }

  async setAlarm(scheduledTime: number) {
    this.alarmAt = scheduledTime
  }

  async deleteAlarm() {
    this.alarmAt = null
  }
}

export class MemoryState implements DurableObjectStateLike {
  readonly storage = new MemoryStorage()

  async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
    return await callback()
  }
}

export class FakeDurableObjectNamespace<TEnv> implements DurableObjectNamespaceLike {
  private readonly instances = new Map<string, DurableObjectInstance>()

  constructor(
    private readonly createInstance: (
      state: DurableObjectStateLike,
      env: TEnv,
    ) => DurableObjectInstance,
    private readonly getEnv: () => TEnv,
  ) {}

  idFromName(name: string) {
    return name
  }

  get(id: string) {
    let instance = this.instances.get(id)

    if (!instance) {
      instance = this.createInstance(new MemoryState(), this.getEnv())
      this.instances.set(id, instance)
    }

    return {
      fetch: async (request: Request | string) => {
        const nextRequest = typeof request === 'string' ? new Request(request) : request

        return instance.fetch(nextRequest)
      },
    }
  }
}
