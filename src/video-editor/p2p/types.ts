export type P2PRole = 'server' | 'client' | 'undecided'

export interface BaseSignalMessage {
	kind: string
	roomId: string
	fromPeerId: string
	toPeerId?: string
	ts: number
}

export interface OfferSignal extends BaseSignalMessage {
	kind: 'offer'
	toPeerId: string
	sdp: RTCSessionDescriptionInit
}

export interface AnswerSignal extends BaseSignalMessage {
	kind: 'answer'
	toPeerId: string
	sdp: RTCSessionDescriptionInit
}

export interface IceCandidateSignal extends BaseSignalMessage {
	kind: 'ice-candidate'
	toPeerId: string
	candidate: RTCIceCandidateInit
}

export interface ServerLeavingSignal extends BaseSignalMessage {
	kind: 'server-leaving'
}

export type SignalMessage = OfferSignal | AnswerSignal | IceCandidateSignal | ServerLeavingSignal

export interface RelayEnvelope {
	relay: true
	payload: unknown
}