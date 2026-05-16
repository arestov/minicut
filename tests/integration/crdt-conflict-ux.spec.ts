import { test } from '@playwright/test'

test.describe('CRDT conflict UX', () => {
	test.skip(
		'two-tab relay shows badge, failed resolve, and successful resolve',
		async () => {
			// Browser CRDT transport is still test-only in MiniCut:
			// createMiniCutDktRuntime rejects non-memory CRDT runtime options outside
			// the node/jsdom harness. Keep the E2E acceptance scenario visible here
			// so it can be enabled when the browser relay is wired.
		},
	)
})
