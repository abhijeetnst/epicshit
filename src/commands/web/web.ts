// /web — start the web command center from inside the running TUI:
//   1. the DopeCode agent API (harness-web/PROTOCOL.md) on 127.0.0.1:4096
//   2. the harness-web Next.js UI on 127.0.0.1:3000, when it's installed
//      (`cd harness-web && npm install` once), pointed at that agent, and opens it in the browser.
// `/web stop` shuts both down. Both also stop when DopeCode exits.
import { type ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { connect } from 'net'
import { dirname, join, resolve } from 'path'
import { startAgentServer, stopAgentServer } from '../../server/agent/server.js'
import type { LocalCommandResult } from '../../types/command.js'
import { openBrowser } from '../../utils/browser.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { sleep } from '../../utils/sleep.js'

const WEB_PORT = Number(process.env.DOPE_WEB_PORT ?? 3000)
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`

let ui: ChildProcess | null = null
let cleanupRegistered = false

function isListening(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.end()
      done(true)
    })
    socket.on('error', () => done(false))
  })
}

// Opens the UI once its port accepts connections; the browser then waits out the first compile.
// ponytail: gives up after ~60s or if `next dev` exits; the URL is still printed either way.
async function openWhenReady(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (await isListening(WEB_PORT)) return void (await openBrowser(WEB_URL))
    if (!ui) return
    await sleep(500)
  }
}

function findHarnessWeb(): string | null {
  const candidates = [
    process.env.DOPE_WEB_DIR,
    process.argv[1] && resolve(dirname(process.argv[1]), '..', 'harness-web'), // dist/cli.mjs
    process.argv[1] && resolve(dirname(process.argv[1]), '..', '..', 'harness-web'), // src/entrypoints/cli.tsx
  ].filter(Boolean) as string[]
  return candidates.find(dir => existsSync(join(dir, 'package.json'))) ?? null
}

function stopAll(): void {
  ui?.kill('SIGTERM')
  ui = null
  stopAgentServer()
}

export async function call(args: string): Promise<LocalCommandResult> {
  if (args.trim() === 'stop') {
    stopAll()
    return { type: 'text', value: 'Web command center stopped.' }
  }
  if (!cleanupRegistered) {
    registerCleanup(async () => stopAll())
    cleanupRegistered = true
  }
  let agent
  try {
    agent = await startAgentServer()
  } catch (error) {
    return { type: 'text', value: `Could not start the agent API: ${(error as Error).message}` }
  }
  const lines = [
    agent.reused
      ? `Using the DopeCode agent already running on ${agent.url}.`
      : `Agent API listening on ${agent.url} (loopback only).`,
  ]
  const webDir = findHarnessWeb()
  if (!webDir) {
    lines.push('harness-web not found; set DOPE_WEB_DIR to its folder, or point any DopeCode Agent Protocol client at the URL above.')
  } else if (!existsSync(join(webDir, 'node_modules', '.bin', 'next'))) {
    lines.push(`Web UI not installed yet: run \`cd ${webDir} && npm install\`, then /web again.`)
  } else if (ui || (await isListening(WEB_PORT))) {
    void openWhenReady()
    lines.push(`Web UI already running on ${WEB_URL} — opening it in your browser.`)
  } else {
    ui = spawn(join(webDir, 'node_modules', '.bin', 'next'), ['dev', '-H', '127.0.0.1', '-p', String(WEB_PORT)], {
      cwd: webDir,
      env: { ...process.env, DOPECODE_AGENT_URL: agent.url },
      stdio: 'ignore',
    })
    ui.on('exit', () => {
      ui = null
    })
    void openWhenReady()
    lines.push(`Web UI starting on ${WEB_URL} — it opens in your browser once it's up (first load compiles, give it a few seconds).`)
  }
  return { type: 'text', value: lines.join('\n') }
}
