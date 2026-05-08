import { test, expect } from '@playwright/test'

test('P0-1 debug: check debug API', async ({ page }) => {
  await page.goto('/')

  // Check if debug API exists
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
  
  expect(debugInfo.hasDebugAPI).toBe(true)
  expect(debugInfo.hasGetSnapshot).toBe(true)
  expect(debugInfo.hasDumpGraph).toBe(true)
  expect(debugInfo.hasDumpProjectState).toBe(true)
})


