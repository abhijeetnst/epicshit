// /session [folder] — open a second, independent DopeCode in a new terminal
// window (Terminal.app on macOS, the first available emulator on Linux,
// Windows Terminal / cmd on Windows). Each process gets its own session id,
// so transcripts under ~/.dope/projects/<folder>/<sessionId>.jsonl never collide.
//
// A new window doesn't inherit this process's environment, so provider
// settings (incl. the key when it came from AI_API_KEY) are handed over in a
// one-shot launcher script (mode 0700) that deletes itself before starting.
import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { LocalCommandResult } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

const FORWARDED_ENV = [
  'AI_API_KEY',
  'OPENAI_API_KEY',
  'AI_PROVIDER',
  'AI_BASE_URL',
  'OPENAI_BASE_URL',
  'AI_MODEL',
  'OPENAI_MODEL',
  'AI_MAX_TOKENS',
  'DOPE_CONFIG_DIR',
  'DOPE_TEST_CMD',
  'DOPE_VERIFY_MAX_ITERATIONS',
]

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function which(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** The command that starts this same DopeCode build (works without `dope` on PATH). */
function dopeArgv(): string[] {
  const script = process.argv[1]
  return script && existsSync(script) ? [process.execPath, script] : ['dope']
}

function writeLauncher(dir: string): string {
  const base = join(process.env.DOPE_CONFIG_DIR || join(homedir(), '.dope'), 'launch')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const id = `${Date.now().toString(36)}-${process.pid}`
  const env = FORWARDED_ENV.filter(k => process.env[k])
  if (process.platform === 'win32') {
    const path = join(base, `session-${id}.cmd`)
    const lines = [
      '@echo off',
      ...env.map(k => `set "${k}=${process.env[k]}"`),
      `cd /d "${dir}"`,
      `(goto) 2>nul & del "%~f0" & ${dopeArgv().map(a => `"${a}"`).join(' ')}`,
    ]
    writeFileSync(path, lines.join('\r\n'), { mode: 0o700 })
    return path
  }
  const path = join(base, `session-${id}.sh`)
  const lines = [
    '#!/bin/sh',
    'rm -f -- "$0"',
    ...env.map(k => `export ${k}=${shq(process.env[k]!)}`),
    `cd ${shq(dir)} || exit 1`,
    `exec ${dopeArgv().map(shq).join(' ')}`,
  ]
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o700 })
  return path
}

function openTerminal(launcher: string, dir: string): string {
  const detached = (cmd: string, args: string[]) => {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  }
  switch (process.platform) {
    case 'darwin': {
      const script = `tell application "Terminal"\n  do script "exec /bin/sh ${launcher.replace(/"/g, '\\"')}"\n  activate\nend tell`
      execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
      return 'Terminal.app'
    }
    case 'win32':
      if (which('wt.exe')) {
        detached('wt.exe', ['-d', dir, 'cmd', '/k', launcher])
        return 'Windows Terminal'
      }
      detached('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', launcher])
      return 'cmd'
    default: {
      const candidates: [string, string[]][] = [
        ['x-terminal-emulator', ['-e', '/bin/sh', launcher]],
        ['gnome-terminal', ['--', '/bin/sh', launcher]],
        ['konsole', ['-e', '/bin/sh', launcher]],
        ['xfce4-terminal', ['-x', '/bin/sh', launcher]],
        ['kitty', ['/bin/sh', launcher]],
        ['alacritty', ['-e', '/bin/sh', launcher]],
        ['xterm', ['-e', '/bin/sh', launcher]],
      ]
      for (const [cmd, args] of candidates) {
        if (which(cmd)) {
          detached(cmd, args)
          return cmd
        }
      }
      throw new Error(
        `No terminal emulator found (tried ${candidates.map(c => c[0]).join(', ')}). Run \`cd ${dir} && dope\` in another terminal instead.`,
      )
    }
  }
}

export async function call(args: string): Promise<LocalCommandResult> {
  const raw = args.trim()
  const dir = raw ? resolve(getCwd(), raw.replace(/^~(?=$|\/)/, homedir())) : getCwd()
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { type: 'text', value: `Not a folder: ${dir}` }
  }
  const launcher = writeLauncher(dir)
  try {
    const where = openTerminal(launcher, dir)
    return { type: 'text', value: `Opened a new DopeCode session in ${dir} (${where}).` }
  } catch (error) {
    rmSync(launcher, { force: true }) // it may hold the key; never leave it behind
    return { type: 'text', value: `Could not open a terminal: ${(error as Error).message}` }
  }
}
