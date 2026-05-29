# P2P graph sync and media transfer

MiniCut P2P uses real browser WebRTC transports in the browser integration path:

- CRDT graph packets travel over the active WebRTC CRDT data channel.
- Resource bytes use the resource transfer path and are not stored in DKT/CRDT graph state.
- Single-user mode must boot and restore from local storage without waiting for a P2P room, signaling server, or WebRTC connection.

Handle-backed local media is a single-browser durability feature. A `FileSystemFileHandle` is stored only in the local side-channel database for that browser profile. It is not replicated to peers. Remote peers can still receive media through the existing P2P media transfer protocol when an owning peer is online.

Reload/rejoin expectations:

- A local single-mode reload restores the DKT graph from storage, then resolves handle-backed resources from the local handle store.
- A P2P peer rejoin replays durable graph state through CRDT storage/sync and fetches resource bytes through the P2P transfer path when needed.
- Missing local handles are rendered as missing/reconnect media, not as broken graph state.
