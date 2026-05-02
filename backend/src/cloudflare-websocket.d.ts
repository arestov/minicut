declare global {
  interface ResponseInit {
    webSocket?: WebSocket | null
  }

  interface WebSocketPair {
    0: WebSocket
    1: WebSocket
  }

  var WebSocketPair: {
    new (): WebSocketPair
  }
}

export {}
