// ponytail: DopeCode is local-only. Analytics, remote feature flags (GrowthBook)
// and telemetry were removed; these no-ops keep the former call sites compiling.
// Delete call sites opportunistically rather than growing this file.

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function logEvent(
  _eventName: string,
  _metadata?: Record<string, unknown>,
): void {}

export async function logEventAsync(
  _eventName: string,
  _metadata?: Record<string, unknown>,
): Promise<void> {}

// Remote feature flags: always the caller's default.
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  _feature: string,
  defaultValue: T,
): T {
  return defaultValue
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  _feature: string,
  defaultValue: T,
  _refreshIntervalMs?: number,
): T {
  return defaultValue
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  _configName: string,
  defaultValue: T,
): T {
  return defaultValue
}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  _configName: string,
  defaultValue: T,
): Promise<T> {
  return defaultValue
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  _gate: string,
): boolean {
  return false
}

export async function checkGate_CACHED_OR_BLOCKING(
  _gate: string,
): Promise<boolean> {
  return false
}

export function sanitizeToolNameForAnalytics(toolName: string): string {
  return toolName
}
