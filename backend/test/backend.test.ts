import { describe, expect, it } from 'vitest'
import type { WorkerEnv } from '../src/contracts'
import worker from '../src/index'
import { SignalingRoom } from '../src/do/SignalingRoom'
import { FakeDurableObjectNamespace } from './fakes'

const createWorkerEnv = (): WorkerEnv => {
  const env = {} as Partial<WorkerEnv>

  const getEnv = () => env as WorkerEnv
  env.SIGNALING_ROOM = new FakeDurableObjectNamespace(
    (state) => new SignalingRoom(state),
    getEnv,
  )

  return env as WorkerEnv
}

describe('minicut backend worker', () => {
  it('returns health endpoint', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/health'), createWorkerEnv())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('returns 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/unknown'), createWorkerEnv())

    expect(response.status).toBe(404)
  })

  it('proxies signaling route into durable object /ws path', async () => {
    const requests: Request[] = []
    const env = {
      SIGNALING_ROOM: {
        idFromName(name: string) {
          return name
        },
        get() {
          return {
            async fetch(request: Request | string) {
              requests.push(typeof request === 'string' ? new Request(request) : request)
              return new Response(null, { status: 426 })
            },
          }
        },
      },
    } as WorkerEnv

    const response = await worker.fetch(
      new Request('https://example.com/api/signal/room-1', {
        headers: { Upgrade: 'websocket' },
      }),
      env,
    )

    expect(response.status).toBe(426)
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).pathname).toBe('/ws')
  })
})
