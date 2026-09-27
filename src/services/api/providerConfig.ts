// Bring-your-own-key provider configuration, shared by the TUI query loop and
// the web command center (src/server/agent). Keys live in
// ~/.dope/providers.json (mode 0600) and never leave this process except in the
// Authorization header of the provider request itself.
//
// Resolution order for the query loop:
//   1. Environment (hackathon / scripted path): AI_API_KEY or OPENAI_API_KEY,
//      optional AI_PROVIDER (deepseek|qwen|openai|openrouter|openai-compatible),
//      AI_BASE_URL / OPENAI_BASE_URL and AI_MODEL / OPENAI_MODEL.
//      With only a key, the provider is auto-detected: DeepSeek first, then the
//      Qwen regions (a 401 moves on to the next candidate, see openaiCompat.ts).
//   2. The active provider chosen in the web UI (providers.json).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type ProviderId = 'deepseek' | 'qwen' | 'openai' | 'openrouter' | 'openai-compatible'

export type CatalogEntry = {
  id: ProviderId
  name: string
  needsBaseUrl: boolean
  keyOptional: boolean
  defaultBaseUrl: string | null
  defaultModels: { id: string; name: string }[]
  /** Model limits we send/assume when the provider doesn't say (per model id prefix). */
  contextWindow: number
  maxOutputTokens: number
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModels: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ],
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba Cloud Model Studio)',
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModels: [
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
      { id: 'qwen-max', name: 'Qwen Max' },
    ],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModels: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini' },
    ],
    contextWindow: 400_000,
    maxOutputTokens: 32_000,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: [
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'qwen/qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
      { id: 'qwen/qwen3-coder-flash', name: 'Qwen3 Coder Flash' },
    ],
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible (vLLM, Ollama, LM Studio…)',
    needsBaseUrl: true,
    keyOptional: true,
    defaultBaseUrl: null,
    defaultModels: [],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
]

/** Endpoints tried, in order, when only a key is given. Qwen keys are region-bound. */
const AUTO_DETECT_CANDIDATES: { provider: ProviderId; baseUrl: string }[] = [
  { provider: 'deepseek', baseUrl: 'https://api.deepseek.com' },
  { provider: 'qwen', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  { provider: 'qwen', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
  { provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
]

export type StoredCredential = { apiKey?: string; baseUrl?: string; models?: string[] }
type StoreFile = {
  active?: { providerId: ProviderId; modelId: string }
  providers: Partial<Record<ProviderId, StoredCredential>>
}

export function getDopeDataDir(): string {
  return process.env.DOPE_CONFIG_DIR || join(homedir(), '.dope')
}

function storePath(): string {
  return join(getDopeDataDir(), 'providers.json')
}

export function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8')) as StoreFile
    return { providers: parsed.providers ?? {}, active: parsed.active }
  } catch {
    return { providers: {} }
  }
}

export function writeStore(store: StoreFile): void {
  mkdirSync(getDopeDataDir(), { recursive: true, mode: 0o700 })
  const path = storePath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
  renameSync(tmp, path)
  chmodSync(path, 0o600)
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return PROVIDER_CATALOG.find(e => e.id === id)
}

export function maskKey(key: string): string {
  return key.length >= 8 ? `••••${key.slice(-4)}` : '••••'
}

export type ResolvedProvider = {
  provider: ProviderId
  baseUrl: string
  apiKey: string | null
  model: string
  /** Remaining auto-detect candidates to try after an auth failure. */
  fallbacks: { provider: ProviderId; baseUrl: string }[]
  source: 'env' | 'store'
  contextWindow: number
  maxOutputTokens: number
}

function inferProviderFromUrl(url: string): ProviderId {
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('dashscope') || url.includes('aliyuncs') || url.includes('maas.')) return 'qwen'
  if (url.includes('openrouter')) return 'openrouter'
  if (url.includes('api.openai.com')) return 'openai'
  return 'openai-compatible'
}

let detected: { provider: ProviderId; baseUrl: string } | null = null

/** Called by the adapter once an auto-detect candidate authenticates. Pass null to forget it (tests). */
export function rememberDetectedEndpoint(provider: ProviderId | null, baseUrl = ''): void {
  detected = provider ? { provider, baseUrl } : null
}

function build(
  provider: ProviderId,
  baseUrl: string,
  apiKey: string | null,
  model: string | undefined,
  source: 'env' | 'store',
  fallbacks: { provider: ProviderId; baseUrl: string }[] = [],
): ResolvedProvider {
  const entry = getCatalogEntry(provider)!
  return {
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: model || entry.defaultModels[0]?.id || 'default',
    fallbacks,
    source,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
  }
}

export function resolveProvider(): ResolvedProvider | null {
  const envKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || null
  const envBase = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || null
  const envModel = process.env.AI_MODEL || process.env.OPENAI_MODEL || undefined
  const envProvider = process.env.AI_PROVIDER as ProviderId | undefined

  if (envKey || envBase) {
    if (envProvider && getCatalogEntry(envProvider)) {
      const base = envBase || getCatalogEntry(envProvider)!.defaultBaseUrl
      if (base) return build(envProvider, base, envKey, envModel, 'env')
    }
    if (envBase) return build(inferProviderFromUrl(envBase), envBase, envKey, envModel, 'env')
    if (envKey?.startsWith('sk-or-')) {
      return build('openrouter', getCatalogEntry('openrouter')!.defaultBaseUrl!, envKey, envModel, 'env')
    }
    // The endpoint that already accepted this key wins; otherwise a model name
    // pins the family when it obviously belongs to one.
    const family = envModel?.startsWith('qwen') ? 'qwen' : envModel?.startsWith('deepseek') ? 'deepseek' : null
    const [start, ...others] = detected
      ? [detected]
      : AUTO_DETECT_CANDIDATES.filter(c => !family || c.provider === family)
    return build(start!.provider, start!.baseUrl, envKey, envModel, 'env', others)
  }

  const store = readStore()
  const active = store.active
  if (!active) return null
  const entry = getCatalogEntry(active.providerId)
  const cred = store.providers[active.providerId]
  const baseUrl = cred?.baseUrl || entry?.defaultBaseUrl
  if (!entry || !baseUrl || (!cred?.apiKey && !entry.keyOptional)) return null
  return build(active.providerId, baseUrl, cred?.apiKey ?? null, active.modelId, 'store')
}

/** Re-resolve against a specific auto-detect candidate (after the previous one got a 401). */
export function withEndpoint(
  resolved: ResolvedProvider,
  next: { provider: ProviderId; baseUrl: string },
): ResolvedProvider {
  const rest = resolved.fallbacks.slice(resolved.fallbacks.indexOf(next) + 1)
  const model =
    resolved.provider === next.provider ? resolved.model : undefined
  return build(next.provider, next.baseUrl, resolved.apiKey, model, resolved.source, rest)
}

export function describeMissingProvider(): string {
  return 'No model provider configured. Set AI_API_KEY (DeepSeek or Qwen key; optionally AI_PROVIDER, AI_MODEL, AI_BASE_URL), or add a key in the web command center (/web).'
}

/** Model id the loop should use when nothing more specific was chosen. */
export function getProviderDefaultModel(): string {
  return resolveProvider()?.model ?? 'deepseek-flash'
}
