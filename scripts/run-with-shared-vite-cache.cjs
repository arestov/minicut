#!/usr/bin/env node

const { spawn } = require('node:child_process')

const script = process.argv[2]
const args = process.argv.slice(3)

if (!script) {
  console.error(
    'Usage: node scripts/run-with-shared-vite-cache.cjs <npm-script> [-- <args>]',
  )
  process.exitCode = 1
  return
}

const npmArgs = args.length > 0 ? ['run', script, '--', ...args] : ['run', script]
const npmCliPath = process.env.npm_execpath

if (!npmCliPath) {
  console.error('npm_execpath is not set; run this helper through npm scripts.')
  process.exitCode = 1
  return
}

const child = spawn(process.execPath, [npmCliPath, ...npmArgs], {
  env: {
    ...process.env,
    MINICUT_VITE_CACHE: 'shared',
  },
  shell: false,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exitCode = code ?? 1
})

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
