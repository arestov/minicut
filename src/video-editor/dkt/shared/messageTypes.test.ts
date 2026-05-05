import { describe, expect, it } from 'vitest'
import { DKT_MSG, isLegacyDktRegistryMessage } from './messageTypes'

describe('isLegacyDktRegistryMessage', () => {
	it('separates registry-command compatibility messages from DKT sync messages', () => {
		expect(isLegacyDktRegistryMessage({ type: DKT_MSG.DISPATCH_COMMAND, command: {} })).toBe(true)
		expect(isLegacyDktRegistryMessage({ type: DKT_MSG.PATCHES, envelope: {} })).toBe(true)
		expect(isLegacyDktRegistryMessage({ type: DKT_MSG.DISPATCH_ACTION, actionName: 'setCursor' })).toBe(false)
		expect(isLegacyDktRegistryMessage({ type: DKT_MSG.SYNC_HANDLE, syncType: 1, payload: {} })).toBe(false)
	})
})
