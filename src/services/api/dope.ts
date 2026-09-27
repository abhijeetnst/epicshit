// Model calls for the agent loop. Every request goes to the user's own
// OpenAI-compatible provider (DeepSeek, Qwen, …) through openaiCompat.ts; this
// module keeps the interface the loop was written against: it yields
// `stream_event`s shaped like message_start/content_block_*/message_delta plus
// one AssistantMessage per content block, with usage and stop_reason written
// back onto the last message.
import { randomUUID } from 'crypto'
import type { QuerySource } from 'src/constants/querySource.js'
import type { Notification } from 'src/context/notifications.js'
import type { AgentId } from 'src/types/ids.js'
import { getCLISyspromptPrefix } from '../../constants/system.js'
import {
  getEmptyToolPermissionContext,
  type QueryChainTracking,
  type ToolPermissionContext,
  type Tools,
  toolMatchesName,
} from '../../Tool.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { TOOL_SEARCH_TOOL_NAME } from '../../tools/ToolSearchTool/prompt.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import { toolToAPISchema } from '../../utils/api.js'
import { getOrCreateUserID } from '../../utils/config.js'
import type { EffortValue } from '../../utils/effort.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  ensureToolResultPairing,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../utils/messages.js'
import { getSmallFastModel } from '../../utils/model/model.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import { getSessionId } from 'src/bootstrap/state.js'
import { API_ERROR_MESSAGE_PREFIX, getAssistantMessageFromError } from './errors.js'
import { EMPTY_USAGE, type NonNullableUsage } from './logging.js'
import { completeText, streamChatCompletion } from './openaiCompat.js'
import {
  describeMissingProvider,
  type ResolvedProvider,
  resolveProvider,
} from './providerConfig.js'
import {
  APIUserAbortError,
  type BetaContentBlock,
  type BetaJSONOutputFormat,
  type BetaMessage,
  type BetaMessageDeltaUsage,
  type BetaRawMessageStreamEvent,
  type BetaStopReason,
  type BetaToolChoiceAuto,
  type BetaToolChoiceTool,
  type BetaToolUnion,
  type MessageParam,
} from './types.js'
import { CannotRetryError, withRetry } from './withRetry.js'

export type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: unknown
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  queryTracking?: QueryChainTracking
  agentId?: AgentId
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notif: Notification) => void
  taskBudget?: { total: number; remaining?: number }
}

type QueryArgs = {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}

/** Upstream model aliases/ids that mean "whatever the provider's default is". */
const PLACEHOLDER_MODEL = /^(dope-|fingers|best|default)/i

function pickModel(requested: string | undefined, provider: ResolvedProvider): string {
  if (!requested || PLACEHOLDER_MODEL.test(requested)) return provider.model
  return requested.replace(/\[1m\]$/i, '')
}

export function getMaxOutputTokensForModel(_model: string): number {
  const override = parseInt(
    process.env.AI_MAX_TOKENS || process.env.DOPE_CODE_MAX_OUTPUT_TOKENS || '',
    10,
  )
  if (Number.isFinite(override) && override > 0) return override
  return resolveProvider()?.maxOutputTokens ?? 8_192
}

export async function* queryModelWithStreaming(
  args: QueryArgs,
): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  yield* queryModel(args)
}

export async function queryModelWithoutStreaming(args: QueryArgs): Promise<AssistantMessage> {
  let last: AssistantMessage | undefined
  const merged: BetaContentBlock[] = []
  for await (const message of queryModel(args)) {
    if (message.type !== 'assistant') continue
    if (message.isApiErrorMessage) return message
    merged.push(...(message.message.content as BetaContentBlock[]).filter(b => b.type !== 'thinking'))
    last = message
  }
  if (!last) {
    if (args.signal.aborted) throw new APIUserAbortError()
    throw new Error('No assistant message found')
  }
  // Callers of the non-streaming API expect one message with every block.
  return { ...last, message: { ...last.message, content: merged } }
}

async function* queryModel({
  messages,
  systemPrompt,
  tools,
  signal,
  options,
}: QueryArgs): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  const provider = resolveProvider()
  if (!provider) {
    yield createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${describeMissingProvider()}`,
      error: 'authentication_failed',
    })
    return
  }
  const model = pickModel(options.model, provider)

  // ToolSearch returns Anthropic tool_reference blocks; OpenAI-compatible
  // endpoints can't use them, so every tool is sent directly.
  const filteredTools = tools.filter(t => !toolMatchesName(t, TOOL_SEARCH_TOOL_NAME))
  const toolSchemas = [
    ...(await Promise.all(
      filteredTools.map(tool =>
        toolToAPISchema(tool, {
          getToolPermissionContext: options.getToolPermissionContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model,
        }),
      ),
    )),
    ...(options.extraToolSchemas ?? []),
  ]

  const normalized = ensureToolResultPairing(
    normalizeMessagesForAPI(messages, filteredTools).map(m =>
      m.type === 'user'
        ? stripToolReferenceBlocksFromUserMessage(m)
        : stripCallerFieldFromAssistantMessage(m),
    ),
  )
  const messagesForAPI: MessageParam[] = normalized.map(m => ({
    role: m.type === 'user' ? 'user' : 'assistant',
    content: m.message.content as MessageParam['content'],
  }))

  const system = [
    getCLISyspromptPrefix({
      isNonInteractive: options.isNonInteractiveSession,
      hasAppendSystemPrompt: options.hasAppendSystemPrompt,
    }),
    ...systemPrompt,
    ...(options.outputFormat
      ? [
          `Respond with a single JSON object matching this JSON Schema, and nothing else:\n${jsonStringify(options.outputFormat.schema)}`,
        ]
      : []),
  ]
    .filter(Boolean)
    .join('\n\n')

  const request = {
    model,
    system,
    messages: messagesForAPI,
    tools: toolSchemas,
    maxTokens: options.maxOutputTokensOverride ?? getMaxOutputTokensForModel(model),
    temperature: options.temperatureOverride,
    toolChoice:
      options.toolChoice?.type === 'tool'
        ? { type: 'tool' as const, name: options.toolChoice.name }
        : undefined,
    jsonOutput: !!options.outputFormat,
  }

  const start = Date.now()
  const newMessages: AssistantMessage[] = []
  const contentBlocks: Record<number, BetaContentBlock & { input?: unknown }> = {}
  let partialMessage: BetaMessage | undefined
  let usage: NonNullableUsage = { ...EMPTY_USAGE }

  try {
    // Retry covers connecting (rate limits, 5xx, network); once tokens flow a
    // failure surfaces as an error message instead of a silent duplicate reply.
    const retry = withRetry(
      async () => {
        const stream = streamChatCompletion(provider, request, signal)
        const first = await stream.next()
        return { stream, first }
      },
      { model, thinkingConfig: { type: 'disabled' }, signal },
    )
    let step = await retry.next()
    while (!step.done) {
      yield step.value
      step = await retry.next()
    }
    const { stream, first } = step.value

    let result = first
    while (!result.done) {
      const part: BetaRawMessageStreamEvent = result.value
      switch (part.type) {
        case 'message_start':
          partialMessage = part.message
          break
        case 'content_block_start':
          contentBlocks[part.index] =
            part.content_block.type === 'tool_use'
              ? { ...part.content_block, input: '' }
              : { ...part.content_block }
          break
        case 'content_block_delta': {
          const block = contentBlocks[part.index] as Record<string, unknown> | undefined
          if (!block) break
          const d = part.delta
          if (d.type === 'text_delta') block.text = (block.text as string) + d.text
          else if (d.type === 'thinking_delta') block.thinking = (block.thinking as string) + d.thinking
          else if (d.type === 'input_json_delta') block.input = (block.input as string) + d.partial_json
          break
        }
        case 'content_block_stop': {
          const block = contentBlocks[part.index]
          if (!block || !partialMessage) break
          if (block.type === 'tool_use' && block.input === '') block.input = '{}'
          const m: AssistantMessage = {
            message: {
              ...partialMessage,
              content: normalizeContentFromAPI([block] as BetaContentBlock[], tools, options.agentId),
            },
            requestId: partialMessage.id,
            type: 'assistant',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
          }
          newMessages.push(m)
          yield m
          break
        }
        case 'message_delta': {
          usage = updateUsage(usage, part.usage)
          const stopReason: BetaStopReason | null = part.delta.stop_reason
          const last = newMessages.at(-1)
          if (last) {
            last.message.usage = usage
            last.message.stop_reason = stopReason
          }
          if (stopReason === 'max_tokens') {
            yield createAssistantAPIErrorMessage({
              content: `${API_ERROR_MESSAGE_PREFIX}: The response hit the ${request.maxTokens} output token limit. Raise it with AI_MAX_TOKENS.`,
              apiError: 'max_output_tokens',
              error: 'max_output_tokens',
            })
          }
          break
        }
      }
      yield {
        type: 'stream_event',
        event: part,
        ...(part.type === 'message_start' ? { ttftMs: Date.now() - start } : undefined),
      } as StreamEvent
      result = await stream.next()
    }
    if (newMessages.length === 0 && !signal.aborted) {
      yield createAssistantAPIErrorMessage({
        content: `${API_ERROR_MESSAGE_PREFIX}: The model returned an empty response.`,
        error: 'unknown',
      })
    }
  } catch (err) {
    const error = err instanceof CannotRetryError ? err.originalError : err
    if (error instanceof APIUserAbortError || signal.aborted) return
    logForDebugging(`Model request failed: ${String(error)}`, { level: 'error' })
    yield getAssistantMessageFromError(error, model, { messages })
  }
}

/**
 * Usage totals are cumulative within one response; input-side counts arrive
 * once, so zeros from later events don't overwrite them.
 */
export function updateUsage(
  usage: Readonly<NonNullableUsage>,
  part: BetaMessageDeltaUsage | undefined,
): NonNullableUsage {
  if (!part) return { ...usage }
  const pick = (next: number | null | undefined, prev: number) =>
    next !== null && next !== undefined && next > 0 ? next : prev
  return {
    ...usage,
    input_tokens: pick(part.input_tokens, usage.input_tokens),
    cache_creation_input_tokens: pick(part.cache_creation_input_tokens, usage.cache_creation_input_tokens),
    cache_read_input_tokens: pick(part.cache_read_input_tokens, usage.cache_read_input_tokens),
    output_tokens: part.output_tokens ?? usage.output_tokens,
  }
}

export function accumulateUsage(
  total: Readonly<NonNullableUsage>,
  message: Readonly<NonNullableUsage>,
): NonNullableUsage {
  return {
    ...message,
    input_tokens: total.input_tokens + message.input_tokens,
    cache_creation_input_tokens: total.cache_creation_input_tokens + message.cache_creation_input_tokens,
    cache_read_input_tokens: total.cache_read_input_tokens + message.cache_read_input_tokens,
    output_tokens: total.output_tokens + message.output_tokens,
    server_tool_use: {
      web_search_requests:
        total.server_tool_use.web_search_requests + message.server_tool_use.web_search_requests,
      web_fetch_requests:
        total.server_tool_use.web_fetch_requests + message.server_tool_use.web_fetch_requests,
    },
    cache_creation: {
      ephemeral_1h_input_tokens:
        total.cache_creation.ephemeral_1h_input_tokens + message.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        total.cache_creation.ephemeral_5m_input_tokens + message.cache_creation.ephemeral_5m_input_tokens,
    },
  }
}

/** Prompt caching is automatic (server-side) on OpenAI-compatible providers. */
export function getCacheControl(_opts?: unknown): { type: 'ephemeral' } {
  return { type: 'ephemeral' }
}

export function getAPIMetadata() {
  return {
    user_id: jsonStringify({ device_id: getOrCreateUserID(), session_id: getSessionId() }),
  }
}

/** True when the key authenticates against the configured provider. */
export async function verifyApiKey(apiKey: string, isNonInteractiveSession: boolean): Promise<boolean> {
  if (isNonInteractiveSession) return true
  const provider = resolveProvider()
  if (!provider) return false
  try {
    await completeText(
      { ...provider, apiKey },
      { model: provider.model, system: '', messages: [{ role: 'user', content: 'ping' }], tools: [], maxTokens: 1 },
      AbortSignal.timeout(20_000),
    )
    return true
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401 || status === 403) return false
    throw error
  }
}

type SideQueryArgs = {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
}

/** Small side query (titles, summaries, classifiers) on the provider's fast model. */
export async function queryfingers({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: SideQueryArgs & { options: Omit<Options, 'model' | 'getToolPermissionContext'> }): Promise<AssistantMessage> {
  return queryWithModel({
    systemPrompt,
    userPrompt,
    outputFormat,
    signal,
    options: { ...options, model: getSmallFastModel() },
  })
}

export async function queryWithModel({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: SideQueryArgs & { options: Omit<Options, 'getToolPermissionContext'> }): Promise<AssistantMessage> {
  return queryModelWithoutStreaming({
    messages: [createUserMessage({ content: userPrompt })],
    systemPrompt,
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal,
    options: {
      ...options,
      outputFormat,
      async getToolPermissionContext() {
        return getEmptyToolPermissionContext()
      },
    },
  })
}
