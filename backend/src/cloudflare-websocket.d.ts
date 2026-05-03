declare global {
  interface ResponseInit {
    webSocket?: WebSocket | null
  }

  interface WebSocketPair {
    0: WebSocket
    1: WebSocket
  }

  interface WebSocket {
    accept?(): void
  }

  var WebSocketPair: {
    new (): WebSocketPair
  }
}

export {}
