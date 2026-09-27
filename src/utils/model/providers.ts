import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../noopTelemetry.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

/**
 * Bedrock / Vertex / Foundry were removed; every request goes through the
 * OpenAI-compatible adapter. 'firstParty' is kept as the single value because
 * model-string tables are keyed by it.
 */
export function getAPIProvider(): APIProvider {
  return 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if the configured base URL is a first-party EpicShit API URL.
 *
 * BYO-key terminal: the endpoint is an OpenAI-compatible base URL, which is
 * never first-party. Only the unset default counts as first-party (in which
 * case requests still need OPENAI_API_KEY to succeed).
 */
export function isFirstPartyEpicShitBaseUrl(): boolean {
  const baseUrl = process.env.OPENAI_BASE_URL
  if (!baseUrl) {
    return true
  }
  return false
}

