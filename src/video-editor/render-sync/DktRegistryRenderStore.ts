import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import type { PatchEnvelope, ProjectRegistry } from '../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

const SYRU_UPDATE_ATTRS = 0
const R_UPDATE_TREE_ATTRS = 4

const SYNC_BATCH_TYPE = 0
const SYNC_ATTRS_NODE_ID = 1
const SYNC_ATTRS_CHANGES_LENGTH = 2
const SYNC_ATTRS_PAYLOAD = 3
const SYNC_TREE_ATTRS_DATA = 2
const SYNC_TREE_ATTRS_LENGTH = 3

type DktSyncMessage = Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>
type Listener = () => void

type DictKey = string | number

const cloneRegistry = (snapshot: ProjectRegistry): ProjectRegistry => structuredClone(snapshot)

class DktRootRegistrySnapshotReceiver {
	#dictFlat: readonly (string | undefined)[] | null = null
	#dictNumsByName = new Map<string, number>()
	#rootNodeId: string | null = null
	#attrsByNodeId = new Map<string, Map<DictKey, unknown>>()

	readRegistrySnapshot(): ProjectRegistry | null {
		if (!this.#rootNodeId) {
			return null
		}

		const attrs = this.#attrsByNodeId.get(this.#rootNodeId)
		if (!attrs) {
			return null
		}

		const dictKey = this.#dictNumsByName.get('registrySnapshot')
		const value = dictKey != null && attrs.has(dictKey)
			? attrs.get(dictKey)
			: attrs.get('registrySnapshot')

		return isRegistrySnapshot(value) ? cloneRegistry(value) : null
	}

	handleSync(message: DktSyncMessage): ProjectRegistry | null {
		switch (message.syncType) {
			case SYNCR_TYPES.SET_DICT:
				this.#setDict(message.payload as readonly (string | undefined)[] | null)
				return null
			case SYNCR_TYPES.TREE_ROOT:
				this.#rootNodeId = toNodeId((message.payload as { node_id?: unknown } | null)?.node_id)
				return this.readRegistrySnapshot()
			case SYNCR_TYPES.UPDATE:
				this.#handleUpdate(message.payload as readonly unknown[])
				return this.readRegistrySnapshot()
			default:
				return null
		}
	}

	#setDict(dictFlat: readonly (string | undefined)[] | null): void {
		this.#dictFlat = dictFlat
		this.#dictNumsByName.clear()
		if (!dictFlat) {
			return
		}
		for (let index = 0; index < dictFlat.length; index += 1) {
			const keyword = dictFlat[index]
			if (keyword) {
				this.#dictNumsByName.set(keyword, index)
			}
		}
	}

	#handleUpdate(list: readonly unknown[]): void {
		let cursor = 0
		while (cursor < list.length) {
			const changeType = list[cursor + SYNC_BATCH_TYPE]
			switch (changeType) {
				case SYRU_UPDATE_ATTRS: {
					const nodeId = toNodeId(list[cursor + SYNC_ATTRS_NODE_ID])
					const changesLength = Number(list[cursor + SYNC_ATTRS_CHANGES_LENGTH] ?? 0)
					const start = cursor + SYNC_ATTRS_PAYLOAD
					this.#applyAttrsFlat(nodeId, list.slice(start, start + changesLength))
					cursor = start + changesLength
					break
				}
				case R_UPDATE_TREE_ATTRS: {
					const nodeId = toNodeId(list[cursor + 1])
					this.#applyAttrsFlat(nodeId, list[cursor + SYNC_TREE_ATTRS_DATA] as readonly unknown[])
					cursor += SYNC_TREE_ATTRS_LENGTH
					break
				}
				case 1:
					cursor += 4
					break
				case 3:
					cursor += 5
					break
				case 5:
					cursor += 4
					break
				case 6:
					cursor += 1
					break
				default:
					throw new Error(`unknown DKT sync update chunk type: ${String(changeType)}`)
			}
		}
	}

	#applyAttrsFlat(nodeId: string | null, attrsFlat: readonly unknown[]): void {
		if (!nodeId) {
			return
		}
		let attrs = this.#attrsByNodeId.get(nodeId)
		if (!attrs) {
			attrs = new Map()
			this.#attrsByNodeId.set(nodeId, attrs)
		}
		for (let index = 0; index < attrsFlat.length; index += 2) {
			attrs.set(attrsFlat[index] as DictKey, attrsFlat[index + 1])
		}
	}
}

export interface RegistryRenderSource {
	getSnapshot(): ProjectRegistry
	subscribe(listener: Listener): () => void
}

export interface DktRegistryRenderStore extends RegistryRenderSource {
	setSnapshot(snapshot: ProjectRegistry): void
	applyPatchEnvelope(envelope: PatchEnvelope): void
	handleDktSyncMessage(message: DktSyncMessage): void
}

const toNodeId = (value: unknown): string | null => value == null ? null : `${value}`

const isRegistrySnapshot = (value: unknown): value is ProjectRegistry => Boolean(
	value
	&& typeof value === 'object'
	&& 'projects' in value
	&& 'entitiesById' in value,
)

/** @deprecated Compatibility source for legacy read models while DKT page runtime rollout is incomplete. */
export const createDktRegistryRenderStore = (initialSnapshot: ProjectRegistry = createEmptyRegistry()): DktRegistryRenderStore => {
	let snapshot = cloneRegistry(initialSnapshot)
	const listeners = new Set<Listener>()
	const receiver = new DktRootRegistrySnapshotReceiver()

	const notify = (): void => {
		for (const listener of listeners) {
			listener()
		}
	}

	const setSnapshot = (nextSnapshot: ProjectRegistry): void => {
		snapshot = cloneRegistry(nextSnapshot)
		notify()
	}

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		setSnapshot,
		applyPatchEnvelope(envelope) {
			setSnapshot(applyPatchEnvelopeToRegistry(snapshot, envelope))
		},
		handleDktSyncMessage(message) {
			const nextSnapshot = receiver.handleSync(message)
			if (nextSnapshot) {
				setSnapshot(nextSnapshot)
			}
		},
	}
}
