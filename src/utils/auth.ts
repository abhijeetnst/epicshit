// Authentication, DopeCode edition: bring-your-own-key only.
//
// There is no login, OAuth, subscription, keychain, apiKeyHelper or cloud
// (Bedrock/Vertex) credential flow any more. The key comes from AI_API_KEY /
// OPENAI_API_KEY or the web command center's providers.json, resolved in
// services/api/providerConfig.ts. The functions below keep the names the rest
// of the tree imports and answer with the BYOK truth.
import { resolveProvider } from '../services/api/providerConfig.js'
import type { AccountInfo } from './config.js'

export type SubscriptionType = 'max' | 'pro' | 'team' | 'enterprise'

export type ApiKeySource = 'OPENAI_API_KEY' | 'apiKeyHelper' | 'stored key' | 'none'

export type UserAccountInfo = {
  subscription?: string
  tokenSource?: string
  apiKeySource?: ApiKeySource
  organization?: string
  email?: string
}

export type OrgValidationResult = { valid: true } | { valid: false; message: string }

/** OAuth-style (subscription) auth never applies. */
export function isEpicShitAuthEnabled(): boolean {
  return false
}

export function getAuthTokenSource(): { source: 'none'; hasToken: false } {
  return { source: 'none', hasToken: false }
}

export function getEpicShitApiKey(): string | null {
  return resolveProvider()?.apiKey ?? null
}

export function getEpicShitApiKeyWithSource(
  _opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): { key: string | null; source: ApiKeySource } {
  const provider = resolveProvider()
  if (!provider?.apiKey) return { key: null, source: 'none' }
  return { key: provider.apiKey, source: provider.source === 'env' ? 'OPENAI_API_KEY' : 'stored key' }
}

/** Keys never come from config or the keychain in DopeCode (env or providers.json only). */
export function getApiKeyFromConfigOrMacOSKeychain(): { key: string; source: ApiKeySource } | null {
  return null
}

// apiKeyHelper / cloud credential caches: nothing to configure, clear or prefetch.
export function getConfiguredApiKeyHelper(): string | undefined {
  return undefined
}
export function getApiKeyHelperElapsedMs(): number {
  return 0
}
export async function getApiKeyFromApiKeyHelper(_isNonInteractiveSession: boolean): Promise<string | null> {
  return null
}
export function clearApiKeyHelperCache(): void {}
export function clearAwsCredentialsCache(): void {}
export function clearGcpCredentialsCache(): void {}
export function prefetchApiKeyFromApiKeyHelperIfSafe(_isNonInteractiveSession: boolean): void {}
export function prefetchGcpCredentialsIfSafe(): void {}
export function prefetchAwsCredentialsAndBedRockInfoIfSafe(): void {}

export function getDopeAIOAuthTokens(): null {
  return null
}
export async function handleOAuth401Error(_failedAccessToken: string): Promise<boolean> {
  return false
}
export function isDopeAISubscriber(): boolean {
  return false
}
export function hasProfileScope(): boolean {
  return false
}
export function getOauthAccountInfo(): AccountInfo | undefined {
  return undefined
}
export function isOverageProvisioningAllowed(): boolean {
  return false
}
export function getSubscriptionType(): SubscriptionType | null {
  return null
}
export function isMaxSubscriber(): boolean {
  return false
}
export function isTeamSubscriber(): boolean {
  return false
}
export function isTeamPremiumSubscriber(): boolean {
  return false
}
export function isEnterpriseSubscriber(): boolean {
  return false
}
export function isProSubscriber(): boolean {
  return false
}
export function getRateLimitTier(): string | null {
  return null
}
export function getSubscriptionName(): string {
  return ''
}
/** Every request goes to a third-party (user-chosen) provider. */
export function isUsing3PServices(): boolean {
  return true
}
export function getAccountInformation(): UserAccountInfo | undefined {
  return undefined
}
export async function validateForceLoginOrg(): Promise<OrgValidationResult> {
  return { valid: true }
}
