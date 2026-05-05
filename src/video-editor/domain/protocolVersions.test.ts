import {
	AUTHORITY_PROTOCOL_VERSION,
	RESOURCE_TRANSFER_PROTOCOL_VERSION,
	type WireMessage,
	MSG,
} from './types'
import { SIGNAL_PROTOCOL_VERSION, type SignalMessage } from '../p2p/types'

describe('protocol versions', () => {
	it('pins authority and transfer protocol versions', () => {
		expect(AUTHORITY_PROTOCOL_VERSION).toBe(1)
		expect(RESOURCE_TRANSFER_PROTOCOL_VERSION).toBe(1)
		expect(SIGNAL_PROTOCOL_VERSION).toBe(1)
	})

	it('accepts optional wire protocol metadata', () => {
		const message: WireMessage = {
			m: MSG.SNAPSHOT_REQUEST,
			meta: {
				protocolVersion: AUTHORITY_PROTOCOL_VERSION,
				schemaVersion: 1,
				capabilities: ['snapshot-restore'],
			},
		}

		expect(message.meta?.protocolVersion).toBe(1)
		expect(message.meta?.capabilities).toContain('snapshot-restore')
	})

	it('accepts optional signaling protocol metadata', () => {
		const signal: SignalMessage = {
			kind: 'server-leaving',
			roomId: 'room-a',
			fromPeerId: 'peer-a',
			ts: Date.now(),
			meta: {
				protocolVersion: SIGNAL_PROTOCOL_VERSION,
				capabilities: ['leader-epoch'],
			},
		}

		expect(signal.meta?.protocolVersion).toBe(1)
		expect(signal.meta?.capabilities).toContain('leader-epoch')
	})
})
