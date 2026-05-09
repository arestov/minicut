import { test, expect } from '@playwright/test'

test('P0-1 debug: check debug API', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as typeof window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ = true
  })
  await page.goto('/')

  // Check if debug API exists
  await expect.poll(() => page.evaluate(() => {
      const debug = (window as any).__MINICUT_P2P_DEBUG__

      if (!debug) return { hasDebugAPI: false }
    
      const keys = Object.keys(debug)
      return {
        hasDebugAPI: true,
        keyCount: keys.length,
        keys: keys.sort(),
        hasGetSnapshot: typeof debug.getSnapshot === 'function',
        hasDumpGraph: typeof debug.dumpGraph === 'function',
        hasDumpProjectState: typeof debug.dumpProjectState === 'function',
      }
  }), { timeout: 20_000 }).toMatchObject({
    hasDebugAPI: true,
    hasGetSnapshot: true,
    hasDumpGraph: true,
    hasDumpProjectState: true,
  })

  const debugInfo = await page.evaluate(() => {
      const debug = (window as any).__MINICUT_P2P_DEBUG__

      if (!debug) return { hasDebugAPI: false }

      const keys = Object.keys(debug)
      return {
        hasDebugAPI: true,
        keyCount: keys.length,
        keys: keys.sort(),
        hasGetSnapshot: typeof debug.getSnapshot === 'function',
        hasDumpGraph: typeof debug.dumpGraph === 'function',
        hasDumpProjectState: typeof debug.dumpProjectState === 'function',
      }
  })
  
  console.log('\n=== DEBUG API INFO ===')
  console.log(JSON.stringify(debugInfo, null, 2))
})


