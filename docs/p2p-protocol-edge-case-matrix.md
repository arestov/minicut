# P2P Protocol: Abstract Spec and Edge-Case Matrix

Date: 2026-05-02

## Scope

This document describes the abstract signaling and state-sync protocol used by the Minicut P2P authority path, and maps edge cases to their runtime guardrails and test coverage.

## Abstract Protocol

### Roles

- `undecided`: peer joined signaling room but not yet assigned authority role.
- `server`: peer owns local authority worker and proxies remote requests over WebRTC DataChannel.
- `client`: peer forwards authority requests to the current server over ordered DataChannel.

### Signaling States

1. Peer opens WebSocket signaling connection and sends `join`.
2. Room emits `room-state` with `leaderPeerId` and `epoch`.
3. Leader peer becomes `server`; other peers become `client(leaderPeerId)`.
4. Peer-to-peer WebRTC exchange runs via signaling messages: `offer`, `answer`, `ice-candidate`.
5. On graceful server leave, server emits `server-leaving`; remaining peers fail over by next `leader-changed` or next `room-state`.

### Authority Transport

- DataChannel carries `WireMessage` request/response traffic.
- Client-side requests are correlated by `requestId` with timeout.
- Patch streams (`MSG.PATCHES`) are broadcast and applied incrementally.
- On failover, cached snapshot is restored in the newly promoted server authority before queued calls are flushed.

## Edge-Case Matrix

Legend:

- Status `Closed`: guarded in runtime and covered by tests.
- Status `Partial`: runtime guard exists but tests or operational guarantees are incomplete.
- Status `Open`: known gap, not fully mitigated.

| ID | Edge case | Runtime behavior / guard | Code location | Test coverage | Status |
| --- | --- | --- | --- | --- | --- |
| SIG-01 | Signaling fails before first `room-state` | Exponential reconnect with capped retries | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`retries when ws closes before room-state`, `fires error after retry budget is exhausted`) | Closed |
| SIG-02 | Signaling closes after already connected | Reconnect path is reused even after first `room-state` | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`reconnects when ws closes after room-state`) | Closed |
| SIG-03 | Duplicate error/close events schedule double reconnect | `ws` null-guard prevents duplicate retry scheduling | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`does not schedule duplicate retries when error is followed by close`) | Closed |
| SIG-04 | Stale leader update arrives out-of-order | Ignore if `epoch < lastLeaderEpoch` | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`ignores stale leader-changed epochs`) | Closed |
| SIG-05 | Repeated room-state causes duplicate connected notifications | `connectedNotified` gate emits `onConnected` once | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`emits connected only once`) | Closed |
| SIG-06 | Member disappears from room-state diff | Known-peer diff emits `onMemberLeft` | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`emits member-left when room-state excludes known peer`) | Closed |
| SIG-07 | Signal not intended for this peer | Ignore self and foreign-target messages | `src/video-editor/p2p/BridgeSignaling.ts` | `BridgeSignaling.test.ts` (`filters self and foreign targeted signals`) | Closed |
| MGR-01 | Signaling error before role is chosen | Error propagated; no forced self-promotion | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`reports signaling errors while role is still undecided`) | Closed |
| MGR-02 | Client transport disconnect and signaling/member-leave both fire | `notifySessionLost` deduplicates session-loss emission | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`emits session-lost once when leader leaves member set`) | Closed |
| MGR-03 | Duplicate `offer` from same remote peer | Existing peer/proxy is closed before replacing PC | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`replaces existing peer connection when duplicate offer arrives`) | Closed |
| MGR-04 | Role flips from server to newer leader | Existing proxies/peers are cleaned before becoming client | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`switches from server role to client role when newer leader epoch is received`) | Closed |
| MGR-05 | Client connection remains disconnected | Watchdog timeout emits error | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`emits timeout error when client connection remains disconnected`) | Closed |
| MGR-06 | Server shuts down gracefully | Emits `server-leaving` then signaling `bye` on destroy | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`announces server-leaving before destroy`) | Closed |
| MGR-07 | Signaling fails after healthy DataChannel | Error ignored if client transport is already ready | `src/video-editor/p2p/PageP2PManager.ts` | `PageP2PManager.test.ts` (`ignores signaling errors after client transport is healthy`) | Closed |
| ADP-01 | Calls made while role undecided | Calls are queued and flushed on activation | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | `P2PAuthorityAdapter.test.ts` (`queues requests while role is undecided`) | Closed |
| ADP-02 | Role never resolves | Pending-call timeout rejects queued calls | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | `P2PAuthorityAdapter.test.ts` (`rejects queued calls when role resolution timeout is exceeded`) | Closed |
| ADP-03 | Session lost with in-flight transport requests | Pending transport requests are cancelled/rejected | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | `P2PAuthorityAdapter.test.ts` (`rejects in-flight client requests on session loss`) | Closed |
| ADP-04 | Client promoted to server after failover | Cached snapshot restored into new local authority | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | `P2PAuthorityAdapter.test.ts` (`hydrates local authority snapshot when client fails over to server`) | Closed |
| ADP-05 | Cross-room state leakage | Room-scoped SharedWorker name isolates authority state | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Indirect: failover/state-sync integration tests use per-room isolation | Partial |
| DO-01 | Durable Object hibernation wake-up | Peer map and leader metadata restored from attachments | `backend/src/do/SignalingRoom.ts` | `backend/test/signaling-room.test.ts` (`survives hibernation and reconstructs state`) | Closed |
| DO-02 | Leader disconnects | New leader selected by earliest `joinedAt`, epoch incremented | `backend/src/do/SignalingRoom.ts` | `backend/test/signaling-room.test.ts` (`leader leaving triggers leader-changed`) | Closed |
| DO-03 | `server-leaving` control message | Relayed to all peers except sender | `backend/src/do/SignalingRoom.ts` | `backend/test/signaling-room.test.ts` (`relays server-leaving to all other peers`) | Closed |
| E2E-01 | Two-peer real WebRTC state convergence | Both peers converge project count after mutation | End-to-end room path | `tests/integration/p2p-state-sync.spec.ts` | Closed |
| E2E-02 | Failover + late joiner convergence | Remaining peer becomes server; late joiner syncs snapshot | End-to-end room path | `tests/integration/p2p-failover.spec.ts` | Closed |
| OPS-01 | Integration tests require local backend and frontend | Playwright `webServer` starts both wrangler and vite automatically | `playwright.config.js` | Verified by successful Playwright run with webServer boot logs | Closed |
| NET-01 | Symmetric NAT / firewall traversal | Only STUN configured by default; TURN not configured | `src/video-editor/p2p/PageP2PManager.ts` | Not covered | Open |
| E2E-03 | Multi-failover with 3+ peers | Not explicitly covered in browser tests | N/A | Not covered | Open |

## Recommended Next Additions

1. Add TURN credentials/config injection and an integration test gate for TURN-enabled connectivity.
2. Add a three-peer failover test sequence (`A=leader`, `A leaves`, `B=leader`, `B leaves`, `C survives`).
3. Add an explicit test asserting room-scope worker isolation by opening two rooms in one browser process and validating no cross-room patch propagation.
