import type { BetaJSONOutputFormat, BetaMessage, BetaThinkingConfigParam, BetaTool, BetaToolChoice, BetaToolUnion, MessageParam, TextBlockParam } from '../services/api/types.js'
import { setLastApiCompletionTimestamp } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { getCLISyspromptPrefix } from '../constants/system.js'
import { collectMessage } from '../services/api/openaiCompat.js'
import { describeMissingProvider, resolveProvider } from '../services/api/providerConfig.js'

type Tool = BetaTool
type ToolChoice = BetaToolChoice

export type SideQueryOptions = {
  /** Model to use for the query */
  model: string
  /**
   * System prompt - string or array of text blocks (will be prefixed with CLI attribution).
   *
   * The attribution header is always placed in its own TextBlockParam block to ensure
   * server-side parsing correctly extracts the cc_entrypoint value without including
   * system prompt content.
   */
  system?: string | TextBlockParam[]
  /** Messages to send (supports cache_control on content blocks) */
  messages: MessageParam[]
  /** Optional tools (supports both standard Tool[] and BetaToolUnion[] for custom tool types) */
  tools?: Tool[] | BetaToolUnion[]
  /** Optional tool choice (use { type: 'tool', name: 'x' } for forced output) */
  tool_choice?: ToolChoice
  /** Optional JSON output format for structured responses */
  output_format?: BetaJSONOutputFormat
  /** Max tokens (default: 1024) */
  max_tokens?: number
  /** Max retries (default: 2) */
  maxRetries?: number
  /** Abort signal */
  signal?: AbortSignal
  /** Skip CLI system prompt prefix (keeps attribution header for OAuth). For internal classifiers that provide their own prompt. */
  skipSystemPromptPrefix?: boolean
  /** Temperature override */
  temperature?: number
  /** Thinking budget (enables thinking), or `false` to send `{ type: 'disabled' }`. */
  thinking?: number | false
  /** Stop sequences — generation stops when any of these strings is emitted */
  stop_sequences?: string[]
  /** Attributes this call in tengu_api_success for COGS joining against reporting.sampling_calls. */
  querySource: QuerySource
}

/**
 * Lightweight API wrapper for "side queries" outside the main conversation loop.
 *
 * Use this instead of direct client.beta.messages.create() calls to ensure
 * proper OAuth token validation with fingerprint attribution headers.
 *
 * This handles:
 * - Fingerprint computation for OAuth validation
 * - Attribution header injection
 * - CLI system prompt prefix
 * - Proper betas for the model
 * - API metadata
 * - Model string normalization (strips [1m] suffix for API)
 *
 * @example
 * // Permission explainer
 * await sideQuery({ querySource: 'permission_explainer', model, system: SYSTEM_PROMPT, messages, tools, tool_choice })
 *
 * @example
 * // Session search
 * await sideQuery({ querySource: 'session_search', model, system: SEARCH_PROMPT, messages })
 *
 * @example
 * // Model validation
 * await sideQuery({ querySource: 'model_validation', model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] })
 */
export async function sideQuery(opts: SideQueryOptions): Promise<BetaMessage> {
  const {
    model,
    system,
    messages,
    tools,
    tool_choice,
    output_format,
    max_tokens = 1024,
    signal,
    skipSystemPromptPrefix,
    temperature,
  } = opts
  const provider = resolveProvider()
  if (!provider) throw new Error(describeMissingProvider())
  const systemText = [
    skipSystemPromptPrefix
      ? ''
      : getCLISyspromptPrefix({ isNonInteractive: false, hasAppendSystemPrompt: false }),
    ...(Array.isArray(system) ? system.map(b => b.text) : [system ?? '']),
    output_format
      ? `Respond with a single JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(output_format.schema)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const response = await collectMessage(
    provider,
    {
      model: /^(dope-|fingers)/i.test(model) ? provider.model : model,
      system: systemText,
      messages,
      tools: (tools ?? []) as BetaToolUnion[],
      maxTokens: Math.max(max_tokens, 256),
      temperature,
      toolChoice: tool_choice?.type === 'tool' ? { type: 'tool', name: tool_choice.name } : undefined,
      jsonOutput: !!output_format,
    },
    signal ?? new AbortController().signal,
  )
  setLastApiCompletionTimestamp(Date.now())
  return response
}
