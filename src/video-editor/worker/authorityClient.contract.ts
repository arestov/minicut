/**
 * Phase 1: Registry-based authority contract removed.
 * DKT authority is tested via createMiniCutDktRuntime.test.ts and integration tests.
 */
export const runAuthorityClientContract = (_options: { label: string; createClient: () => unknown }): void => {
	// No-op: legacy registry protocol tests removed in Phase 1 rewrite
}