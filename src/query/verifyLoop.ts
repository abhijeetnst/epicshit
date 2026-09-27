// Self-correcting loop: when the main agent tries to stop after editing files,
// run the project's test/build command. A non-zero exit feeds the output back
// as a blocking message so the model keeps going and fixes it — up to
// DOPE_VERIFY_MAX_ITERATIONS failed checks per user prompt (default 3), so a
// genuinely unfixable failure can't burn the user's key forever. This cap is
// separate from the token budget.
//
// Command: DOPE_TEST_CMD if set (DOPE_TEST_CMD=off disables), else detected:
// package.json "test" script, Makefile `test:` target, pytest, cargo, go.
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execa } from 'execa'
import type { Message } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const DEFAULT_MAX_ITERATIONS = 3
const OUTPUT_TAIL_CHARS = 6000
const TIMEOUT_MS = 5 * 60_000

const failuresByPrompt = new Map<string, number>()

export function getMaxVerifyIterations(): number {
  const n = parseInt(process.env.DOPE_VERIFY_MAX_ITERATIONS || '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_ITERATIONS
}

export function detectTestCommand(cwd: string): string | null {
  const env = process.env.DOPE_TEST_CMD?.trim()
  if (env) return /^(off|none|0|false)$/i.test(env) ? null : env
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const test = JSON.parse(readFileSync(pkgPath, 'utf8'))?.scripts?.test as string | undefined
      if (test && !/no test specified/.test(test)) {
        const runner = existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))
          ? 'bun run'
          : existsSync(join(cwd, 'pnpm-lock.yaml'))
            ? 'pnpm'
            : existsSync(join(cwd, 'yarn.lock'))
              ? 'yarn'
              : 'npm'
        return `${runner} test`
      }
    } catch {}
  }
  const makefile = join(cwd, 'Makefile')
  if (existsSync(makefile) && /^test:/m.test(readFileSync(makefile, 'utf8'))) return 'make test'
  if (['pytest.ini', 'pyproject.toml', 'tests'].some(f => existsSync(join(cwd, f)))) return 'python3 -m pytest -q'
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo test'
  if (existsSync(join(cwd, 'go.mod'))) return 'go test ./...'
  return null
}

/** The prompt that started this turn, and whether files were edited since. */
function currentTurn(messages: Message[]): { promptId: string; edited: boolean } | null {
  let edited = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'assistant') {
      for (const block of m.message.content) {
        if (block.type === 'tool_use' && EDIT_TOOLS.has(block.name)) edited = true
      }
    } else if (m.type === 'user' && !m.isMeta && !m.toolUseResult) {
      const content = m.message.content
      const isToolResult = Array.isArray(content) && content.every(b => b.type === 'tool_result')
      if (!isToolResult) return { promptId: m.uuid, edited }
    }
  }
  return null
}

export type VerifyOutcome =
  | { kind: 'skip' }
  | { kind: 'passed'; command: string }
  | { kind: 'failed'; command: string; attempt: number; max: number; output: string }
  | { kind: 'gave_up'; command: string; max: number }

export async function runVerification(messages: Message[], signal?: AbortSignal): Promise<VerifyOutcome> {
  const turn = currentTurn(messages)
  if (!turn?.edited) return { kind: 'skip' }
  const cwd = getCwd()
  const command = detectTestCommand(cwd)
  if (!command) return { kind: 'skip' }
  const max = getMaxVerifyIterations()
  const failures = failuresByPrompt.get(turn.promptId) ?? 0
  if (max === 0) return { kind: 'skip' }

  const result = await execa(command, {
    shell: true,
    cwd,
    reject: false,
    all: true,
    timeout: TIMEOUT_MS,
    cancelSignal: signal,
    env: { CI: '1', FORCE_COLOR: '0' },
  })
  if (result.exitCode === 0 && !result.timedOut) {
    failuresByPrompt.delete(turn.promptId)
    return { kind: 'passed', command }
  }
  if (failures >= max) return { kind: 'gave_up', command, max }
  failuresByPrompt.set(turn.promptId, failures + 1)
  const all = String(result.all ?? '')
  const output = (result.timedOut ? `[timed out after ${TIMEOUT_MS / 1000}s]\n` : '') +
    (all.length > OUTPUT_TAIL_CHARS ? `…${all.slice(-OUTPUT_TAIL_CHARS)}` : all)
  return { kind: 'failed', command, attempt: failures + 1, max, output }
}
