import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

type SignalMessage =
	| { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
	| { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
	| { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

type DirectPeerHandle = {
	label: string
	context: BrowserContext
	page: Page
	close(): Promise<void>
}

const DIRECT_ENDPOINT_SCRIPT = `
(() => {
  const state = {
    label: null,
    pc: null,
    dc: null,
    remote: null,
    packets: [],
    events: [],
  };
  const emit = (event, details = {}) => {
    state.events.push({ event, ...details });
  };
  const ensurePc = async (remote) => {
    state.remote = remote;
    if (state.pc) return state.pc;
    const pc = new RTCPeerConnection({ iceServers: [] });
    state.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.__transportSignalSend({
          kind: 'ice',
          from: state.label,
          to: state.remote,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.ondatachannel = (event) => {
      attachDc(event.channel);
    };
    return pc;
  };
  const attachDc = (dc) => {
    state.dc = dc;
    dc.onopen = () => emit('channel-open', { remote: state.remote });
    dc.onmessage = (event) => {
      state.packets.push(JSON.parse(String(event.data)));
      emit('packet-received', { remote: state.remote });
    };
    dc.onclose = () => emit('channel-closed', { remote: state.remote });
  };
  window.__directTransport = {
    async init(label) {
      state.label = label;
      emit('init', { label });
    },
    async connect(remote) {
      const pc = await ensurePc(remote);
      attachDc(pc.createDataChannel('minicut-crdt', { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await window.__transportSignalSend({
        kind: 'offer',
        from: state.label,
        to: remote,
        sdp: pc.localDescription.toJSON(),
      });
    },
    async handleSignal(message) {
      const pc = await ensurePc(message.from);
      if (message.kind === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await window.__transportSignalSend({
          kind: 'answer',
          from: state.label,
          to: message.from,
          sdp: pc.localDescription.toJSON(),
        });
        return;
      }
      if (message.kind === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        return;
      }
      if (message.kind === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    },
    send(packet) {
      state.dc.send(JSON.stringify(packet));
    },
    snapshot() {
      return {
        label: state.label,
        remote: state.remote,
        readyState: state.dc ? state.dc.readyState : null,
        packets: state.packets.slice(),
        events: state.events.slice(),
      };
    },
    close() {
      state.dc?.close();
      state.pc?.close();
    },
  };
})();
`

const SHARED_WORKER_CENTER_PAGE_SCRIPT = `
(() => {
  const state = {
    tabId: null,
    roomId: null,
    worker: null,
    ownerGeneration: null,
    pc: null,
    dcByPeer: new Map(),
    packets: [],
    events: [],
  };
  const emit = (event, details = {}) => {
    state.events.push({ event, ...details });
  };
  const postWorker = (message) => state.worker.port.postMessage({ tabId: state.tabId, ...message });
  const ensurePc = async (remote) => {
    if (state.pc) return state.pc;
    const pc = new RTCPeerConnection({ iceServers: [] });
    state.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.__transportSignalSend({
          kind: 'ice',
          from: state.tabId,
          to: remote,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.ondatachannel = (event) => {
      attachDc(remote, event.channel);
    };
    return pc;
  };
  const attachDc = (remote, dc) => {
    state.dcByPeer.set(remote, dc);
    dc.onopen = () => {
      emit('remote-channel-open', { remote });
      postWorker({ type: 'PEER_ATTACHED', peerId: remote });
    };
    dc.onmessage = (event) => {
      const packet = JSON.parse(String(event.data));
      postWorker({ type: 'PACKET_RECEIVED', sourcePeerId: remote, packet });
    };
  };
  const sendToRemote = (message) => {
    const target = message.targetPeerId || [...state.dcByPeer.keys()][0];
    const dc = state.dcByPeer.get(target);
    if (!dc || dc.readyState !== 'open') {
      emit('send-deferred-no-channel', { target });
      return false;
    }
    dc.send(JSON.stringify(message.packet));
    emit('packet-sent', { target });
    return true;
  };
  window.__workerCenteredTransport = {
    async init({ tabId, roomId, canHostWebRtc }) {
      state.tabId = tabId;
      state.roomId = roomId;
      state.worker = new SharedWorker('/transport-prototype-shared-worker.js', { name: 'transport-prototype:' + roomId });
      state.worker.onerror = (error) => {
        emit('worker-error', { message: error.message || String(error) });
      };
      state.worker.port.onmessage = (event) => {
        const message = event.data;
        emit('worker-message', { messageType: message.type });
        if (message.type === 'ATTACH_WEBRTC') {
          state.ownerGeneration = message.generation;
          postWorker({ type: 'OWNER_ATTACHED', roomId, generation: message.generation });
          return;
        }
        if (message.type === 'SEND_PACKET') {
          sendToRemote(message);
          return;
        }
        if (message.type === 'PACKET_RECEIVED') {
          state.packets.push(message);
          return;
        }
      };
      state.worker.port.start();
      postWorker({ type: 'TAB_HELLO', roomId, canHostWebRtc });
    },
    async connect(remote) {
      const pc = await ensurePc(remote);
      const dc = pc.createDataChannel('minicut-crdt', { ordered: true });
      attachDc(remote, dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await window.__transportSignalSend({
        kind: 'offer',
        from: state.tabId,
        to: remote,
        sdp: pc.localDescription.toJSON(),
      });
    },
    async handleSignal(message) {
      const pc = await ensurePc(message.from);
      if (message.kind === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await window.__transportSignalSend({
          kind: 'answer',
          from: state.tabId,
          to: message.from,
          sdp: pc.localDescription.toJSON(),
        });
        return;
      }
      if (message.kind === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        return;
      }
      if (message.kind === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    },
    sendFromWorker(packet, targetPeerId) {
      postWorker({ type: 'SEND_FROM_WORKER', roomId: state.roomId, packet, targetPeerId });
    },
    snapshot() {
      return {
        tabId: state.tabId,
        ownerGeneration: state.ownerGeneration,
        remotePeers: [...state.dcByPeer.keys()],
        packets: state.packets.slice(),
        events: state.events.slice(),
      };
    },
    close() {
      for (const dc of state.dcByPeer.values()) dc.close();
      state.pc?.close();
      state.worker?.port.close();
    },
  };
})();
`

const installSignalRelay = async (
	handles: Map<string, Page>,
	context: BrowserContext,
): Promise<void> => {
	await context.exposeBinding('__transportSignalSend', async (_source, message: SignalMessage) => {
		const target = handles.get(message.to)
		if (!target) {
			throw new Error(`unknown signal target ${message.to}`)
		}
		await target.evaluate((incoming) => {
			const endpoint =
				window.__directTransport ?? window.__workerCenteredTransport
			return endpoint.handleSignal(incoming)
		}, message)
	})
}

const openDirectPeer = async (
	browser: Browser,
	handles: Map<string, Page>,
	label: string,
	baseURL: string,
): Promise<DirectPeerHandle> => {
	const context = await browser.newContext()
	await installSignalRelay(handles, context)
	const page = await context.newPage()
	await page.goto(`${baseURL}/?transportPrototype=${encodeURIComponent(label)}`)
	await page.addScriptTag({ content: DIRECT_ENDPOINT_SCRIPT })
	await page.evaluate((peerLabel) => window.__directTransport.init(peerLabel), label)
	handles.set(label, page)
	return {
		label,
		context,
		page,
		close: async () => {
			await page.evaluate(() => window.__directTransport.close()).catch(() => undefined)
			await context.close()
			handles.delete(label)
		},
	}
}

const waitForDirectReady = async (page: Page): Promise<void> => {
	await expect.poll(async () => page.evaluate(() => window.__directTransport.snapshot().readyState), {
		timeout: 10_000,
	}).toBe('open')
}

test('transport prototype: browser tab to browser tab WebRTC carries opaque CRDT packets', async ({ browser, baseURL }) => {
	const handles = new Map<string, Page>()
	const origin = baseURL ?? 'http://127.0.0.1:4174'
	const a = await openDirectPeer(browser, handles, 'peer-a', origin)
	const b = await openDirectPeer(browser, handles, 'peer-b', origin)

	try {
		await a.page.evaluate(() => window.__directTransport.connect('peer-b'))
		await Promise.all([waitForDirectReady(a.page), waitForDirectReady(b.page)])

		await a.page.evaluate(() => window.__directTransport.send({ type: 'crdt', batches: [{ id: 'a1' }] }))
		await b.page.evaluate(() => window.__directTransport.send({ type: 'crdt', batches: [{ id: 'b1' }] }))

		await expect.poll(async () => b.page.evaluate(() => window.__directTransport.snapshot().packets)).toEqual([
			{ type: 'crdt', batches: [{ id: 'a1' }] },
		])
		await expect.poll(async () => a.page.evaluate(() => window.__directTransport.snapshot().packets)).toEqual([
			{ type: 'crdt', batches: [{ id: 'b1' }] },
		])
	} finally {
		await Promise.all([a.close(), b.close()])
	}
})

test('transport prototype: SharedWorker center owns send/receive while one tab owns WebRTC', async ({ browser, baseURL }) => {
	const handles = new Map<string, Page>()
	const origin = baseURL ?? 'http://127.0.0.1:4174'
	const localContext = await browser.newContext()
	const remoteContext = await browser.newContext()
	await Promise.all([
		installSignalRelay(handles, localContext),
		installSignalRelay(handles, remoteContext),
	])
	const ownerTab = await localContext.newPage()
	const viewTab = await localContext.newPage()
	const remoteTab = await remoteContext.newPage()

	try {
		for (const page of [ownerTab, viewTab, remoteTab]) {
			await page.goto(`${origin}/?transportPrototype=shared-worker`)
			await page.addScriptTag({ content: SHARED_WORKER_CENTER_PAGE_SCRIPT })
		}
		handles.set('owner-tab', ownerTab)
		handles.set('view-tab', viewTab)
		handles.set('remote-peer', remoteTab)

		await ownerTab.evaluate(() =>
			window.__workerCenteredTransport.init({
				tabId: 'owner-tab',
				roomId: 'room-a',
				canHostWebRtc: true,
			}),
		)
		await viewTab.evaluate(() =>
			window.__workerCenteredTransport.init({
				tabId: 'view-tab',
				roomId: 'room-a',
				canHostWebRtc: true,
			}),
		)
		await remoteTab.evaluate(() =>
			window.__workerCenteredTransport.init({
				tabId: 'remote-peer',
				roomId: 'room-b',
				canHostWebRtc: true,
			}),
		)

		await expect.poll(async () => ownerTab.evaluate(() => window.__workerCenteredTransport.snapshot().ownerGeneration), {
			timeout: 10_000,
		}).toBe(1)
		await expect.poll(async () => viewTab.evaluate(() => window.__workerCenteredTransport.snapshot().ownerGeneration)).toBe(null)

		await ownerTab.evaluate(() => window.__workerCenteredTransport.connect('remote-peer'))
		await expect.poll(async () => ownerTab.evaluate(() => window.__workerCenteredTransport.snapshot().remotePeers)).toContain('remote-peer')
		await expect.poll(async () => remoteTab.evaluate(() => window.__workerCenteredTransport.snapshot().remotePeers)).toContain('owner-tab')

		await ownerTab.evaluate(() =>
			window.__workerCenteredTransport.sendFromWorker(
				{ type: 'crdt', batches: [{ id: 'local-baseline' }] },
				'remote-peer',
			),
		)
		await expect.poll(async () => remoteTab.evaluate(() => window.__workerCenteredTransport.snapshot().packets), {
			timeout: 10_000,
		}).toEqual([
			expect.objectContaining({
				sourcePeerId: 'owner-tab',
				packet: { type: 'crdt', batches: [{ id: 'local-baseline' }] },
			}),
		])

		await remoteTab.evaluate(() =>
			window.__workerCenteredTransport.sendFromWorker(
				{ type: 'crdt', batches: [{ id: 'remote-edit' }] },
				'owner-tab',
			),
		)
		await expect.poll(async () => viewTab.evaluate(() => window.__workerCenteredTransport.snapshot().packets), {
			timeout: 10_000,
		}).toEqual([
			expect.objectContaining({
				sourcePeerId: 'remote-peer',
				packet: { type: 'crdt', batches: [{ id: 'remote-edit' }] },
			}),
		])
	} finally {
		await Promise.all([
			ownerTab.evaluate(() => window.__workerCenteredTransport.close()).catch(() => undefined),
			viewTab.evaluate(() => window.__workerCenteredTransport.close()).catch(() => undefined),
			remoteTab.evaluate(() => window.__workerCenteredTransport.close()).catch(() => undefined),
		])
		await Promise.all([localContext.close(), remoteContext.close()])
	}
})

declare global {
	interface Window {
		__transportSignalSend(message: SignalMessage): Promise<void>
		__directTransport: {
			init(label: string): Promise<void>
			connect(remote: string): Promise<void>
			handleSignal(message: SignalMessage): Promise<void>
			send(packet: unknown): void
			snapshot(): {
				readyState: RTCDataChannelState | null
				packets: unknown[]
			}
			close(): void
		}
		__workerCenteredTransport: {
			init(options: {
				tabId: string
				roomId: string
				canHostWebRtc: boolean
			}): Promise<void>
			connect(remote: string): Promise<void>
			handleSignal(message: SignalMessage): Promise<void>
			sendFromWorker(packet: unknown, targetPeerId?: string): void
			snapshot(): {
				ownerGeneration: number | null
				remotePeers: string[]
				packets: unknown[]
			}
			close(): void
		}
	}
}
