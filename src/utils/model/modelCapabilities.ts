import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import isEqual from 'lodash-es/isEqual.js'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { z } from 'zod/v4'
import { OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { isDopeAISubscriber } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { getDopeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import { lazySchema } from '../lazySchema.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { jsonStringify } from '../slowOperations.js'
import { getAPIProvider, isFirstPartyEpicShitBaseUrl } from './providers.js'

// .strip() — don't persist internal-only fields (mycro_deployments etc.) to disk
const ModelCapabilitySchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      max_input_tokens: z.number().optional(),
      max_tokens: z.number().optional(),
    })
    .strip(),
)

const CacheFileSchema = lazySchema(() =>
  z.object({
    models: z.array(ModelCapabilitySchema()),
    timestamp: z.number(),
  }),
)

export type ModelCapability = z.infer<ReturnType<typeof ModelCapabilitySchema>>

function getCacheDir(): string {
  return join(getDopeConfigHomeDir(), 'cache')
}

function getCachePath(): string {
  return join(getCacheDir(), 'model-capabilities.json')
}

function isModelCapabilitiesEligible(): boolean {
  if (process.env.USER_TYPE !== 'ant') return false
  if (getAPIProvider() !== 'firstParty') return false
  if (!isFirstPartyEpicShitBaseUrl()) return false
  return true
}

// Longest-id-first so substring match prefers most specific; secondary key for stable isEqual
function sortForMatching(models: ModelCapability[]): ModelCapability[] {
  return [...models].sort(
    (a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id),
  )
}

// Keyed on cache path so tests that set DOPE_CONFIG_DIR get a fresh read
const loadCache = memoize(
  (path: string): ModelCapability[] | null => {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- memoized; called from sync getContextWindowForModel
      const raw = readFileSync(path, 'utf-8')
      const parsed = CacheFileSchema().safeParse(safeParseJSON(raw, false))
      return parsed.success ? parsed.data.models : null
    } catch {
      return null
    }
  },
  path => path,
)

export function getModelCapability(model: string): ModelCapability | undefined {
  if (!isModelCapabilitiesEligible()) return undefined
  const cached = loadCache(getCachePath())
  if (!cached || cached.length === 0) return undefined
  const m = model.toLowerCase()
  const exact = cached.find(c => c.id.toLowerCase() === m)
  if (exact) return exact
  return cached.find(c => m.includes(c.id.toLowerCase()))
}

export async function refreshModelCapabilities(): Promise<void> {
  // Model capabilities came from Anthropic's /v1/models; OpenAI-compatible
  // providers don't publish context/output limits there, so nothing to fetch.
}
