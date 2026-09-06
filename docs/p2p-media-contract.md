# P2P graph sync and media transfer

MiniCut P2P uses real browser WebRTC transports in the browser integration path:

- CRDT graph packets travel over the active WebRTC CRDT data channel.
- Resource bytes use the resource transfer path and are not stored in DKT/CRDT graph state.
- Single-user mode must boot and restore from local storage without waiting for a P2P room, signaling server, or WebRTC connection.

Handle-backed local media and OPFS project copies are single-browser durability
features. Handles and project media bytes remain in local side-channel stores;
neither is serialized into CRDT packets or replicated to peers. Only the
serializable resource descriptor and content fingerprint participate in graph
sync. Remote peers continue to receive bytes through the existing P2P media
transfer protocol when an owning peer is online.

Reload/rejoin expectations:

- A local single-mode reload restores the DKT graph, resolves a committed OPFS
  project copy first, then tries a granted handle, and finally leaves the
  existing P2P transfer fallback available.
- A P2P peer rejoin replays durable graph state through CRDT storage/sync and fetches resource bytes through the P2P transfer path when needed.
- Missing/denied local handles are availability states, not broken graph state;
  a project copy remains previewable and exportable.

OPFS is not cross-device sync, cross-browser replication, or a portable project
archive. Clearing origin data removes local copies without changing the P2P
wire protocol.
