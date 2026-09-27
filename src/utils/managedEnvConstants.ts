/**
 * Environment variables that control inference routing: which provider to use,
 * which endpoint to hit, and which model IDs to send.
 *
 * When DOPE_CODE_PROVIDER_MANAGED_BY_HOST is truthy in the spawn env, these
 * are stripped from settings-sourced env so the host's routing config isn't
 * overridden by a user's ~/.dope/settings.json — e.g. a Bedrock setup for
 * terminal CLI that would break a host that only supports first-party auth.
 *
 * @[MODEL LAUNCH]: New models usually don't need changes here —
 * VERTEX_REGION_DOPE_* is prefix-matched. New providers or new routing
 * config vars (endpoint, project, region, auth) do.
 */
const PROVIDER_MANAGED_ENV_VARS = new Set([
  // The flag itself — settings can't unset it once the host set it
  'DOPE_CODE_PROVIDER_MANAGED_BY_HOST',
  // Provider selection
  'DOPE_CODE_USE_BEDROCK',
  'DOPE_CODE_USE_VERTEX',
  'DOPE_CODE_USE_FOUNDRY',
  // Endpoint config (base URLs, project/resource identifiers)
  'OPENAI_BASE_URL',
  'EPICSHIT_BEDROCK_BASE_URL',
  'EPICSHIT_VERTEX_BASE_URL',
  'EPICSHIT_FOUNDRY_BASE_URL',
  'EPICSHIT_FOUNDRY_RESOURCE',
  'EPICSHIT_VERTEX_PROJECT_ID',
  // Region routing (per-model VERTEX_REGION_DOPE_* handled by prefix below)
  'CLOUD_ML_REGION',
  // Auth
  'OPENAI_API_KEY',
  'OPENAI_AUTH_TOKEN',
  'DOPE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'EPICSHIT_FOUNDRY_API_KEY',
  'DOPE_CODE_SKIP_BEDROCK_AUTH',
  'DOPE_CODE_SKIP_VERTEX_AUTH',
  'DOPE_CODE_SKIP_FOUNDRY_AUTH',
  // Model defaults — often set to provider-specific ID formats
  'OPENAI_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_fingers_MODEL_NAME',
  'OPENAI_DEFAULT_fingers_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_fingers_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_fingers_MODEL_NAME',
  'OPENAI_DEFAULT_fingers_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_fingers_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_fingers_MODEL_NAME',
  'OPENAI_DEFAULT_fingers_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_SMALL_FAST_MODEL',
  'EPICSHIT_SMALL_FAST_MODEL_AWS_REGION',
  'DOPE_CODE_SUBAGENT_MODEL',
])

const PROVIDER_MANAGED_ENV_PREFIXES = [
  // Per-model Vertex region overrides — scales with model releases, so
  // prefix-matched to avoid drift on each launch.
  'VERTEX_REGION_DOPE_',
]

export function isProviderManagedEnvVar(key: string): boolean {
  const upper = key.toUpperCase()
  return (
    PROVIDER_MANAGED_ENV_VARS.has(upper) ||
    PROVIDER_MANAGED_ENV_PREFIXES.some(p => upper.startsWith(p))
  )
}

/**
 * Dangerous shell settings that can execute arbitrary shell code
 */
export const DANGEROUS_SHELL_SETTINGS = [
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
  'otelHeadersHelper',
  'statusLine',
] as const

/**
 * Safe environment variables that can be applied before trust dialog.
 * These are Dope Code specific settings that don't pose security risks.
 *
 * IMPORTANT: This is the source of truth for which env vars are safe.
 * Any env var NOT in this list is considered dangerous and will trigger
 * a security dialog when set via remote managed settings.
 *
 * Dangerous env vars (NOT in this list):
 *
 * === REDIRECT TO ATTACKER-CONTROLLED SERVER ===
 * - OPENAI_BASE_URL, EPICSHIT_BEDROCK_BASE_URL, EPICSHIT_FOUNDRY_BASE_URL, EPICSHIT_VERTEX_BASE_URL
 * - HTTP_PROXY, HTTPS_PROXY, NO_PROXY, http_proxy, https_proxy, no_proxy
 * - OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
 *
 * === TRUST ATTACKER-CONTROLLED SERVER ===
 * - NODE_TLS_REJECT_UNAUTHORIZED
 * - NODE_EXTRA_CA_CERTS
 *
 * === SWITCH TO ATTACKER-CONTROLLED PROJECT ===
 * - EPICSHIT_FOUNDRY_RESOURCE
 * - OPENAI_API_KEY, OPENAI_AUTH_TOKEN
 * - AWS_BEARER_TOKEN_BEDROCK
 */
export const SAFE_ENV_VARS = new Set([
  'OPENAI_CUSTOM_HEADERS',
  'OPENAI_CUSTOM_MODEL_OPTION',
  'OPENAI_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'OPENAI_CUSTOM_MODEL_OPTION_NAME',
  'OPENAI_DEFAULT_fingers_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_fingers_MODEL_NAME',
  'OPENAI_DEFAULT_fingers_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_fingers_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_fingers_MODEL_NAME',
  'OPENAI_DEFAULT_fingers_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_fingers_MODEL',
  'OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_fingers_MODEL_NAME',
  'OPENAI_DEFAULT_fingers_MODEL_SUPPORTED_CAPABILITIES',
  'EPICSHIT_FOUNDRY_API_KEY',
  'OPENAI_MODEL',
  'EPICSHIT_SMALL_FAST_MODEL_AWS_REGION',
  'OPENAI_SMALL_FAST_MODEL',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'BASH_MAX_TIMEOUT_MS',
  'DOPE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'DOPE_CODE_API_KEY_HELPER_TTL_MS',
  'DOPE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'DOPE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DOPE_CODE_DISABLE_TERMINAL_TITLE',
  'DOPE_CODE_ENABLE_TELEMETRY',
  'DOPE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'DOPE_CODE_IDE_SKIP_AUTO_INSTALL',
  'DOPE_CODE_MAX_OUTPUT_TOKENS',
  'DOPE_CODE_SKIP_BEDROCK_AUTH',
  'DOPE_CODE_SKIP_FOUNDRY_AUTH',
  'DOPE_CODE_SKIP_VERTEX_AUTH',
  'DOPE_CODE_SUBAGENT_MODEL',
  'DOPE_CODE_USE_BEDROCK',
  'DOPE_CODE_USE_FOUNDRY',
  'DOPE_CODE_USE_VERTEX',
  'DISABLE_AUTOUPDATER',
  'DISABLE_BUG_COMMAND',
  'DISABLE_COST_WARNINGS',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_FEEDBACK_COMMAND',
  'DISABLE_TELEMETRY',
  'ENABLE_TOOL_SEARCH',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE',
  'OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_LOG_TOOL_DETAILS',
  'OTEL_LOG_USER_PROMPTS',
  'OTEL_LOGS_EXPORT_INTERVAL',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRIC_EXPORT_INTERVAL',
  'OTEL_METRICS_EXPORTER',
  'OTEL_METRICS_INCLUDE_ACCOUNT_UUID',
  'OTEL_METRICS_INCLUDE_SESSION_ID',
  'OTEL_METRICS_INCLUDE_VERSION',
  'OTEL_RESOURCE_ATTRIBUTES',
  'USE_BUILTIN_RIPGREP',
  'VERTEX_REGION_DOPE_3_5_fingers',
  'VERTEX_REGION_DOPE_3_5_fingers',
  'VERTEX_REGION_DOPE_3_7_fingers',
  'VERTEX_REGION_DOPE_4_0_fingers',
  'VERTEX_REGION_DOPE_4_0_fingers',
  'VERTEX_REGION_DOPE_4_1_fingers',
  'VERTEX_REGION_DOPE_4_5_fingers',
  'VERTEX_REGION_DOPE_4_6_fingers',
  'VERTEX_REGION_DOPE_fingers_4_5',
])

