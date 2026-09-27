// DopeCode Agent Protocol server (harness-web/PROTOCOL.md) — the real agent
// behind the web command center, replacing harness-web/mock-agent.
//
// Started from inside the running TUI by /web. Each turn runs the same DopeCode
// query loop + OpenAI-compatible adapter in a child `dope -p` process whose cwd
// is the project folder, so tabs on different folders run in parallel without
// sharing process-global state, and "stop" is just killing that child.
//
// Security (harness-web/AGENTS.md): loopback only; non-loopback Host and any
// Origin are rejected; optional bearer DOPECODE_AGENT_TOKEN; keys are stored
// in ~/.dope/providers.json (0600), only ever returned as a masked keyHint, and
// request bodies are never logged.
import { type ChildProcess, spawn } from 'child_process'
import { randomUUID, timingSafeEqual } from 'crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import type {
  AgentEvent,
  DirListing,
  GitInfo,
  Message,
  ModelRef,
  Project,
  Provider,
  ServerInfo,
  Session,
  SetProviderBody,
  TextPart,
  ToolPart,
} from '../../../harness-web/lib/protocol.js'
import {
  getCatalogEntry,
  getDopeDataDir,
  maskKey,
  PROVIDER_CATALOG,
  type ProviderId,
  readStore,
  type StoredCredential,
  writeStore,
} from '../../services/api/providerConfig.js'

const PROTOCOL_VERSION = 1
const HOST = '127.0.0.1'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const TOOL_OUTPUT_LIMIT = 20_000

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

// ── State (projects, sessions, messages) ─────────────────────────────────────

type Snapshot = {
  projects: Project[]
  sessions: Session[]
  messages: Record<string, Message[]>
  /** web session id -> DopeCode transcript session id (for --resume) */
  dopeSessions: Record<string, string>
}

const stateFile = () => join(getDopeDataDir(), 'web', 'state.json')
const projects = new Map<string, Project>()
const sessions = new Map<string, Session>()
const messages = new Map<string, Message[]>()
const dopeSessions = new Map<string, string>()

function loadState(): void {
  let snap: Snapshot
  try {
    snap = JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    return
  }
  for (const p of snap.projects ?? []) projects.set(p.id, p)
  for (const s of snap.sessions ?? []) sessions.set(s.id, { ...s, status: 'idle' })
  for (const [id, list] of Object.entries(snap.messages ?? {})) {
    messages.set(
      id,
      list.map(m => (m.status === 'streaming' ? { ...m, status: 'aborted' } : m)),
    )
  }
  for (const [k, v] of Object.entries(snap.dopeSessions ?? {})) dopeSessions.set(k, v)
}

let saveTimer: NodeJS.Timeout | null = null
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 300)
}
function saveNow(): void {
  const file = stateFile()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const snap: Snapshot = {
    projects: [...projects.values()],
    sessions: [...sessions.values()],
    messages: Object.fromEntries(messages),
    dopeSessions: Object.fromEntries(dopeSessions),
  }
  writeFileSync(`${file}.tmp`, JSON.stringify(snap), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`

// ── Event stream ─────────────────────────────────────────────────────────────

const clients = new Set<ServerResponse>()
function emit(event: AgentEvent): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`
  for (const res of clients) res.write(frame)
}
function touchSession(session: Session, patch: Partial<Session> = {}): Session {
  const next = { ...session, ...patch, updatedAt: Date.now() }
  sessions.set(next.id, next)
  emit({ type: 'session.updated', session: next })
  scheduleSave()
  return next
}

// ── Providers (BYOK) ─────────────────────────────────────────────────────────

/** Stored credential, or the AI_API_KEY the TUI was started with (hackathon path). */
function effectiveCred(id: ProviderId): StoredCredential & { fromEnv?: boolean } {
  const stored = readStore().providers[id]
  if (stored?.apiKey || stored?.baseUrl) return stored
  const envKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY
  const envProvider = process.env.AI_PROVIDER
  // Same routing as resolveProvider: an OpenRouter key only works against OpenRouter.
  const envTarget = envProvider ?? (envKey?.startsWith('sk-or-') ? 'openrouter' : undefined)
  if (envKey && (envTarget ? envTarget === id : id === 'deepseek' || id === 'qwen')) {
    // A base URL from the environment only applies to the provider AI_PROVIDER pins.
    const envBase = envProvider ? process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL : undefined
    const envModel = process.env.AI_MODEL || process.env.OPENAI_MODEL
    const models = stored?.models ?? (envModel ? [envModel] : undefined)
    return { ...stored, apiKey: envKey, ...(envBase && { baseUrl: envBase }), ...(models && { models }), fromEnv: true }
  }
  return stored ?? {}
}

function toProvider(id: ProviderId): Provider {
  const entry = getCatalogEntry(id)!
  const cred = effectiveCred(id)
  return {
    id,
    name: entry.name,
    configured: entry.needsBaseUrl ? Boolean(cred.baseUrl) : Boolean(cred.apiKey),
    keyHint: cred.apiKey ? maskKey(cred.apiKey) : null,
    baseUrl: cred.baseUrl ?? entry.defaultBaseUrl,
    needsBaseUrl: entry.needsBaseUrl,
    keyOptional: entry.keyOptional,
    editableModels: true,
    models: cred.models?.length ? cred.models.map(m => ({ id: m, name: m })) : entry.defaultModels,
  }
}

function mustCatalog(id: string) {
  const entry = getCatalogEntry(id)
  if (!entry) throw new HttpError(404, `Unknown provider: ${id}`)
  return entry
}

function setProvider(id: string, body: SetProviderBody): Provider {
  const entry = mustCatalog(id)
  const store = readStore()
  const next: StoredCredential = { ...store.providers[entry.id] }
  if (body.apiKey !== undefined) {
    const key = String(body.apiKey).trim()
    if (key) {
      if (key.length > 512 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an API key.")
      next.apiKey = key
    }
  }
  if (body.baseUrl !== undefined) {
    const raw = String(body.baseUrl).trim()
    if (raw) {
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        throw new HttpError(400, 'Base URL must be a full http(s) URL.')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Base URL must use http or https.')
      next.baseUrl = raw.replace(/\/+$/, '')
    } else {
      delete next.baseUrl
    }
  }
  if (body.models !== undefined) {
    if (!Array.isArray(body.models)) throw new HttpError(400, 'models must be a list of model IDs.')
    const models = [...new Set(body.models.map(m => String(m).trim()).filter(Boolean))]
    if (models.length > 50 || models.some(m => m.length > 200)) throw new HttpError(400, 'Too many or too long model IDs.')
    if (models.length) next.models = models
    else delete next.models
  }
  if (entry.needsBaseUrl && !next.baseUrl) throw new HttpError(400, `${entry.name} needs a base URL.`)
  if (!entry.keyOptional && !next.apiKey) throw new HttpError(400, `Enter an API key for ${entry.name}.`)
  if (!entry.defaultModels.length && !next.models?.length) throw new HttpError(400, `Add at least one model ID for ${entry.name}.`)
  store.providers[entry.id] = next
  store.active ??= { providerId: entry.id, modelId: next.models?.[0] ?? entry.defaultModels[0]?.id ?? '' }
  writeStore(store)
  return toProvider(entry.id)
}

function clearProvider(id: string): Provider {
  const entry = mustCatalog(id)
  const store = readStore()
  delete store.providers[entry.id]
  if (store.active?.providerId === entry.id) delete store.active
  writeStore(store)
  return toProvider(entry.id)
}

// ── Filesystem (folder picker) ───────────────────────────────────────────────

function resolveUserPath(input: string | null | undefined): string {
  const raw = (input ?? '').trim()
  if (!raw || raw === '~') return homedir()
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2))
  if (!isAbsolute(raw)) throw new HttpError(400, 'Use an absolute path (or one starting with ~/).')
  return resolve(raw)
}

function fsError(err: unknown, path: string): HttpError {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return new HttpError(404, `No such folder: ${path}`)
  if (code === 'ENOTDIR') return new HttpError(400, `Not a folder: ${path}`)
  if (code === 'EACCES' || code === 'EPERM') return new HttpError(403, `Permission denied: ${path}`)
  return new HttpError(500, `Can't read ${path}`)
}

const exists = (p: string) => stat(p).then(() => true, () => false)

async function listDir(path: string, hidden: boolean): Promise<DirListing> {
  let dirents
  try {
    dirents = await readdir(path, { withFileTypes: true })
  } catch (err) {
    throw fsError(err, path)
  }
  const entries = (
    await Promise.all(
      dirents
        .filter(d => (hidden || !d.name.startsWith('.')) && (d.isDirectory() || d.isSymbolicLink()))
        .map(async d => {
          const full = join(path, d.name)
          if (d.isSymbolicLink() && !(await stat(full).then(s => s.isDirectory(), () => false))) return null
          return { name: d.name, path: full, git: await exists(join(full, '.git')) }
        }),
    )
  )
    .filter(e => e !== null)
    .sort((a, b) => a!.name.localeCompare(b!.name, undefined, { sensitivity: 'base', numeric: true }))
  const parent = dirname(path)
  return { path, parent: parent === path ? null : parent, entries: entries as DirListing['entries'] }
}

async function gitInfo(path: string): Promise<GitInfo | null> {
  for (let dir = path; ; dir = dirname(dir)) {
    const dotGit = join(dir, '.git')
    const s = await stat(dotGit).catch(() => null)
    if (s) {
      try {
        let gitDir = dotGit
        if (s.isFile()) {
          const pointer = (await readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
          if (!pointer) return { branch: null }
          gitDir = resolve(dir, pointer)
        }
        const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
        return { branch: head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1] ?? null }
      } catch {
        return { branch: null }
      }
    }
    if (dirname(dir) === dir) return null
  }
}

// ── Turns ────────────────────────────────────────────────────────────────────

const running = new Map<string, { child: ChildProcess; aborted: boolean }>()

function childEnv(model: ModelRef): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(AI_|OPENAI_)/.test(k) || k === 'DOPECODE_AGENT_TOKEN') continue
    env[k] = v
  }
  const entry = getCatalogEntry(model.providerId)!
  const cred = effectiveCred(entry.id)
  env.AI_PROVIDER = entry.id
  env.AI_MODEL = model.modelId
  const baseUrl = cred.baseUrl ?? entry.defaultBaseUrl
  if (baseUrl) env.AI_BASE_URL = baseUrl
  if (cred.apiKey) env.AI_API_KEY = cred.apiKey
  env.DOPE_WEB_TURN = '1'
  return env
}

function dopeCommand(): string[] {
  const script = process.argv[1]
  return script ? [process.execPath, script] : ['dope']
}

function toolTitle(name: string, input: Record<string, unknown>): string {
  const pick = input.file_path ?? input.command ?? input.pattern ?? input.path ?? input.url ?? input.description ?? input.prompt
  const text = typeof pick === 'string' ? pick : name
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

function toolResultText(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('\n')
        : ''
  return text.length > TOOL_OUTPUT_LIMIT ? `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n… (truncated)` : text
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.replace(/\s+/g, ' ')
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || 'Untitled'
}

function startTurn(session: Session, project: Project, model: ModelRef, text: string) {
  const list = messages.get(session.id) ?? []
  messages.set(session.id, list)
  const user: Message = {
    id: newId('msg'),
    sessionId: session.id,
    role: 'user',
    createdAt: Date.now(),
    status: 'done',
    parts: [{ id: newId('prt'), type: 'text', text }],
  }
  const assistant: Message = {
    id: newId('msg'),
    sessionId: session.id,
    role: 'assistant',
    createdAt: Date.now(),
    model,
    status: 'streaming',
    parts: [],
  }
  list.push(user, assistant)
  emit({ type: 'message.updated', message: user })
  emit({ type: 'message.updated', message: assistant })
  touchSession(session, { status: 'busy', title: session.title ?? titleFrom(text) })

  const [cmd, ...base] = dopeCommand()
  const resumeId = dopeSessions.get(session.id)
  const args = [
    ...base,
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // The web UI has no permission prompts: file edits and shell commands in
    // the chosen folder are allowed, anything else is denied.
    '--permission-mode', 'acceptEdits',
    ...(resumeId ? ['--resume', resumeId] : []),
    '--allowedTools', 'Bash',
  ]
  const child = spawn(cmd!, args, { cwd: project.path, env: childEnv(model), stdio: ['pipe', 'pipe', 'pipe'] })
  const run = { child, aborted: false }
  running.set(session.id, run)
  child.stdin!.end(text)

  const partFor = (part: TextPart | ToolPart) => {
    const i = assistant.parts.findIndex(p => p.id === part.id)
    if (i === -1) assistant.parts.push(part)
    else assistant.parts[i] = part
    emit({ type: 'part.updated', sessionId: session.id, messageId: assistant.id, part })
  }
  let textPart: TextPart | null = null
  const tools = new Map<string, ToolPart>()
  let finished = false
  let stderrTail = ''

  const handle = (msg: any) => {
    if (msg.session_id && !resumeId && msg.type === 'system' && msg.subtype === 'init') {
      dopeSessions.set(session.id, msg.session_id)
      scheduleSave()
    }
    if (msg.type === 'stream_event') {
      const ev = msg.event
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
        textPart = { id: newId('prt'), type: 'text', text: '' }
        partFor(textPart)
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && textPart) {
        textPart.text += ev.delta.text
        emit({ type: 'part.delta', sessionId: session.id, messageId: assistant.id, partId: textPart.id, delta: ev.delta.text })
      } else if (ev.type === 'content_block_stop') {
        textPart = null
      }
    } else if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type !== 'tool_use') continue
        const input = (block.input ?? {}) as Record<string, unknown>
        const part: ToolPart = { id: newId('prt'), type: 'tool', tool: block.name, title: toolTitle(block.name, input), input, status: 'running' }
        tools.set(block.id, part)
        partFor(part)
      }
    } else if (msg.type === 'user') {
      const content = msg.message?.content
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type !== 'tool_result') continue
        const part = tools.get(block.tool_use_id)
        if (!part) continue
        part.status = block.is_error ? 'error' : 'done'
        part.output = toolResultText(block.content)
        partFor(part)
      }
    } else if (msg.type === 'result') {
      finished = true
      if (msg.is_error) {
        assistant.status = 'error'
        assistant.error = (msg.errors?.join('\n') || msg.result || 'The agent reported an error.').slice(0, 2000)
      } else {
        assistant.status = 'done'
      }
    }
  }

  let buffer = ''
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('{')) continue
      try {
        handle(JSON.parse(line))
      } catch {
        // not a protocol line
      }
    }
  })
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000)
  })
  child.on('close', code => {
    running.delete(session.id)
    if (run.aborted) assistant.status = 'aborted'
    else if (!finished) {
      assistant.status = 'error'
      assistant.error = `The agent process exited unexpectedly (code ${code}).${stderrTail ? `\n${stderrTail.trim()}` : ''}`
    }
    for (const part of assistant.parts) {
      if (part.type === 'tool' && part.status === 'running') {
        part.status = 'error'
        part.output = run.aborted ? 'Stopped' : 'Interrupted'
      }
    }
    emit({ type: 'message.updated', message: assistant })
    const latest = sessions.get(session.id)
    if (latest) touchSession(latest, { status: 'idle' })
    scheduleSave()
  })

  return { userMessageId: user.id, assistantMessageId: assistant.id }
}

function abortTurn(sessionId: string): void {
  const run = running.get(sessionId)
  if (!run) return
  run.aborted = true
  run.child.kill('SIGINT')
  setTimeout(() => run.child.exitCode === null && run.child.kill('SIGKILL'), 3000).unref()
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

function tokenMatches(header: string | undefined): boolean {
  const token = process.env.DOPECODE_AGENT_TOKEN
  if (!token) return true
  const expected = Buffer.from(`Bearer ${token}`)
  const got = Buffer.from(header ?? '')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

function guard(req: IncomingMessage): string | null {
  const host = (req.headers.host ?? '').toLowerCase()
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!
  if (!LOOPBACK_HOSTS.has(hostname)) return 'Host not allowed.'
  if (req.headers.origin) return 'Call the agent through the web app, not from a browser page.'
  if (!tokenMatches(req.headers.authorization)) return 'Missing or wrong agent token.'
  return null
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  if (!(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new HttpError(415, 'Send a JSON body (content-type: application/json).')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > 1_000_000) throw new HttpError(413, 'Request body is too large.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
  } catch {
    throw new HttpError(400, "Request body isn't valid JSON.")
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function info(): ServerInfo {
  return {
    name: 'DopeCode',
    version: typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.0',
    protocol: PROTOCOL_VERSION,
    mock: false,
    home: homedir(),
    keyStorage: `${join(getDopeDataDir(), 'providers.json')} (readable only by your user)`,
  }
}

const mustProject = (id: string) => {
  const p = projects.get(id)
  if (!p) throw new HttpError(404, 'Project not found.')
  return p
}
const mustSession = (id: string) => {
  const s = sessions.get(id)
  if (!s) throw new HttpError(404, 'Session not found.')
  return s
}

function deleteSession(id: string): void {
  abortTurn(id)
  sessions.delete(id)
  messages.delete(id)
  dopeSessions.delete(id)
  emit({ type: 'session.deleted', sessionId: id })
}

const STREAMING = Symbol('streaming')
class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; params: string[] }
const routes: [string, RegExp, (ctx: Ctx) => unknown][] = [
  ['GET', /^\/health$/, () => info()],
  ['GET', /^\/events$/, ({ res }) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 2000\n\n')
    clients.add(res)
    res.on('close', () => clients.delete(res))
    res.write(`data: ${JSON.stringify({ type: 'server.connected', info: info() })}\n\n`)
    return STREAMING
  }],
  ['GET', /^\/fs\/list$/, ({ url }) => listDir(resolveUserPath(url.searchParams.get('path')), url.searchParams.get('hidden') === '1')],
  ['GET', /^\/projects$/, async () => {
    const list = await Promise.all(
      [...projects.values()].map(async p => {
        const git = await gitInfo(p.path)
        if (JSON.stringify(git) === JSON.stringify(p.git)) return p
        const next = { ...p, git }
        projects.set(p.id, next)
        scheduleSave()
        return next
      }),
    )
    return list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }],
  ['POST', /^\/projects$/, async ({ req }) => {
    const path = resolveUserPath((await readJson<{ path?: string }>(req)).path)
    const s = await stat(path).catch(err => {
      throw fsError(err, path)
    })
    if (!s.isDirectory()) throw new HttpError(400, `Not a folder: ${path}`)
    const existing = [...projects.values()].find(p => p.path === path)
    const project: Project = { id: existing?.id ?? newId('prj'), path, name: basename(path) || path, git: await gitInfo(path), lastOpenedAt: Date.now() }
    projects.set(project.id, project)
    emit({ type: 'project.updated', project })
    scheduleSave()
    return new Reply(existing ? 200 : 201, project)
  }],
  ['DELETE', /^\/projects\/([^/]+)$/, ({ params: [id] }) => {
    mustProject(id!)
    for (const s of [...sessions.values()]) if (s.projectId === id) deleteSession(s.id)
    projects.delete(id!)
    emit({ type: 'project.deleted', projectId: id! })
    scheduleSave()
    return new Reply(204)
  }],
  ['GET', /^\/projects\/([^/]+)\/sessions$/, ({ params: [id] }) => {
    mustProject(id!)
    return [...sessions.values()].filter(s => s.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt)
  }],
  ['POST', /^\/projects\/([^/]+)\/sessions$/, async ({ req, params: [id] }) => {
    const project = mustProject(id!)
    const { title } = await readJson<{ title?: string }>(req)
    const now = Date.now()
    const session: Session = { id: newId('ses'), projectId: project.id, title: title?.trim().slice(0, 120) || null, status: 'idle', createdAt: now, updatedAt: now }
    sessions.set(session.id, session)
    messages.set(session.id, [])
    const touched = { ...project, lastOpenedAt: now }
    projects.set(project.id, touched)
    emit({ type: 'session.updated', session })
    emit({ type: 'project.updated', project: touched })
    scheduleSave()
    return new Reply(201, session)
  }],
  ['GET', /^\/sessions\/([^/]+)$/, ({ params: [id] }) => ({ session: mustSession(id!), messages: messages.get(id!) ?? [] })],
  ['PATCH', /^\/sessions\/([^/]+)$/, async ({ req, params: [id] }) => {
    const session = mustSession(id!)
    const { title } = await readJson<{ title?: string }>(req)
    const clean = typeof title === 'string' ? title.trim().slice(0, 120) : ''
    if (!clean) throw new HttpError(400, "Title can't be empty.")
    return touchSession(session, { title: clean })
  }],
  ['DELETE', /^\/sessions\/([^/]+)$/, ({ params: [id] }) => {
    mustSession(id!)
    deleteSession(id!)
    scheduleSave()
    return new Reply(204)
  }],
  ['POST', /^\/sessions\/([^/]+)\/messages$/, async ({ req, params: [id] }) => {
    const session = mustSession(id!)
    const project = mustProject(session.projectId)
    const body = await readJson<{ text?: string; model?: ModelRef }>(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) throw new HttpError(400, 'Message is empty.')
    if (text.length > 100_000) throw new HttpError(413, 'Message is too long.')
    if (running.has(session.id)) throw new HttpError(409, 'This session is still working. Stop it first.')
    const entry = body.model?.providerId ? getCatalogEntry(body.model.providerId) : undefined
    if (!entry) throw new HttpError(400, 'Pick a model first.')
    const provider = toProvider(entry.id)
    if (!provider.configured) throw new HttpError(400, `Add your ${provider.name} key first (Keys, top right).`)
    if (!provider.models.some(m => m.id === body.model!.modelId)) {
      throw new HttpError(400, `${provider.name} has no model called ${body.model!.modelId}.`)
    }
    const model = { providerId: entry.id, modelId: body.model!.modelId }
    const store = readStore()
    if (store.providers[entry.id]) {
      store.active = model as { providerId: ProviderId; modelId: string }
      writeStore(store) // the TUI follows the last model picked in the web UI
    }
    return new Reply(202, startTurn(session, project, model, text))
  }],
  ['POST', /^\/sessions\/([^/]+)\/abort$/, ({ params: [id] }) => {
    mustSession(id!)
    abortTurn(id!)
    return new Reply(204)
  }],
  ['GET', /^\/providers$/, () => PROVIDER_CATALOG.map(e => toProvider(e.id))],
  ['PUT', /^\/providers\/([^/]+)$/, async ({ req, params: [id] }) => {
    const provider = setProvider(id!, await readJson<SetProviderBody>(req))
    emit({ type: 'provider.updated', provider })
    return provider
  }],
  ['DELETE', /^\/providers\/([^/]+)$/, ({ params: [id] }) => {
    const provider = clearProvider(id!)
    emit({ type: 'provider.updated', provider })
    return provider
  }],
]

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rejected = guard(req)
  if (rejected) return send(res, 403, { error: rejected })
  const url = new URL(req.url ?? '/', `http://${HOST}`)
  const method = req.method ?? 'GET'
  const matches = routes.filter(([, re]) => re.test(url.pathname))
  if (!matches.length) return send(res, 404, { error: `No route for ${url.pathname}` })
  const route = matches.find(([m]) => m === method)
  if (!route) return send(res, 405, { error: `${method} isn't supported on ${url.pathname}` })
  const params = (url.pathname.match(route[1]) ?? []).slice(1).map(decodeURIComponent)
  const result = await route[2]({ req, res, url, params })
  if (result === STREAMING) return
  if (result instanceof Reply) return send(res, result.status, result.body)
  return send(res, result === undefined ? 204 : 200, result)
}

let server: Server | null = null
let pingTimer: NodeJS.Timeout | null = null

export type AgentServerHandle = { url: string; port: number; reused?: boolean }

async function probeAgent(port: number): Promise<'dopecode' | 'mock' | 'other'> {
  try {
    const headers: Record<string, string> = process.env.DOPECODE_AGENT_TOKEN
      ? { authorization: `Bearer ${process.env.DOPECODE_AGENT_TOKEN}` }
      : {}
    const res = await fetch(`http://${HOST}:${port}/health`, { headers, signal: AbortSignal.timeout(2000) })
    const body = (await res.json()) as Partial<ServerInfo>
    if (body.protocol !== PROTOCOL_VERSION) return 'other'
    return body.mock ? 'mock' : 'dopecode'
  } catch {
    return 'other'
  }
}

/** Starts (once) and resolves with the listening address. */
export function startAgentServer(port = Number(process.env.DOPECODE_AGENT_PORT ?? 4096)): Promise<AgentServerHandle> {
  if (server?.listening) {
    const addr = server.address() as { port: number }
    return Promise.resolve({ url: `http://${HOST}:${addr.port}`, port: addr.port })
  }
  loadState()
  server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.end()
      if (err instanceof HttpError) return send(res, err.status, { error: err.message })
      send(res, 500, { error: 'The agent hit an internal error.' })
    })
  })
  pingTimer = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n')
  }, 15_000)
  pingTimer.unref()
  return new Promise((resolvePromise, reject) => {
    server!.once('error', (err: NodeJS.ErrnoException) => {
      server = null
      if (err.code !== 'EADDRINUSE') return reject(err)
      // Something already serves this port: reuse it when it's another DopeCode agent.
      void probeAgent(port).then(existing =>
        existing === 'dopecode'
          ? resolvePromise({ url: `http://${HOST}:${port}`, port, reused: true })
          : reject(
              new Error(
                existing === 'mock'
                  ? `harness-web's mock agent is running on port ${port}. Stop it (or run \`npm run dev\` in harness-web, which now starts the real agent), then try again.`
                  : `Port ${port} is already in use. Set DOPECODE_AGENT_PORT to use another one.`,
              ),
            ),
      )
    })
    server!.listen(port, HOST, () => {
      const addr = server!.address() as { port: number }
      resolvePromise({ url: `http://${HOST}:${addr.port}`, port: addr.port })
    })
  })
}

export function stopAgentServer(): void {
  for (const id of running.keys()) abortTurn(id)
  for (const res of clients) res.end()
  clients.clear()
  if (pingTimer) clearInterval(pingTimer)
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (server) saveNow()
  server?.close()
  server = null
}
