import type { WorkerEnv } from './contracts'
import { SignalingRoom } from './do/SignalingRoom'

const emptyResponse = () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  })

const errorResponse = (status: number, message: string) => jsonResponse({ error: message }, status)

const buildDurableObjectWebSocketRequest = (request: Request, path: string) => {
  const url = new URL(request.url)
  url.protocol = 'https:'
  url.hostname = 'internal'
  url.pathname = path
  url.search = ''

  return new Request(url.toString(), request)
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return emptyResponse()
    }

    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return jsonResponse({ ok: true })
    }

    const signalingMatch = /^\/api\/signal\/([^/]+)$/.exec(url.pathname)
    if (signalingMatch) {
      const roomId = decodeURIComponent(signalingMatch[1])
      const objectId = env.SIGNALING_ROOM.idFromName(`room:${roomId}`)
      const stub = env.SIGNALING_ROOM.get(objectId)
      return stub.fetch(buildDurableObjectWebSocketRequest(request, '/ws'))
    }

    return errorResponse(404, 'Route not found')
  },
}

export default worker
export { SignalingRoom }
