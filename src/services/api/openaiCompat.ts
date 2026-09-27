// OpenAI-compatible Chat Completions adapter (DeepSeek, Qwen/DashScope,
// OpenAI, OpenRouter, vLLM/Ollama/LM Studio).
//
// The agent loop is built around block-based messages and Anthropic-style
// stream events (message_start / content_block_* / message_delta). This module
// translates in both directions so the loop, tools, hooks and todo tracking
// don't change:
//   internal messages + tool schemas  ->  POST {baseUrl}/chat/completions
//   chat.completion.chunk SSE         ->  BetaRawMessageStreamEvent sequence
//
// Reasoning models stream their thinking — `reasoning_content` (DeepSeek,
// Qwen/DashScope) or `reasoning` / `reasoning_details` (OpenRouter). It becomes
// a `thinking` block and is sent back on later assistant turns in the field
// that provider expects (DeepSeek rejects multi-turn tool use without it).
import {
  type ResolvedProvider,
  rememberDetectedEndpoint,
  withEndpoint,
} from './providerConfig.js'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  type BetaContentBlock,
  type BetaRawMessageStreamEvent,
  type BetaStopReason,
  type BetaToolUnion,
  type ContentBlockParam,
  makeAPIError,
  type MessageParam,
} from './types.js'

// ── Request side ─────────────────────────────────────────────────────────────

type ChatToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: ChatToolCall[]
      reasoning_content?: string
      reasoning?: string
    }
  | { role: 'tool'; tool_call_id: string; content: string }

type ChatTool = {
  type: 'function'
  function: { name: string; description?: string; parameters: unknown }
}

function blockText(block: ContentBlockParam): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'image':
      return '[image omitted: this model endpoint receives text only]'
    case 'document':
      return block.source.type === 'text'
        ? block.source.data
        : '[document omitted: this model endpoint receives text only]'
    default:
      return ''
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(b => blockText(b as ContentBlockParam))
    .filter(Boolean)
    .join('\n')
}

/** Where a provider wants prior reasoning on assistant messages (null: don't send it). */
export type ReasoningField = 'reasoning_content' | 'reasoning' | null

export function reasoningFieldFor(provider: string): ReasoningField {
  if (provider === 'openrouter') return 'reasoning'
  if (provider === 'openai') return null
  return 'reasoning_content'
}

/** Internal (Anthropic-shaped) conversation -> Chat Completions messages. */
export function toChatMessages(
  system: string,
  messages: MessageParam[],
  reasoningField: ReasoningField = 'reasoning_content',
): ChatMessage[] {
  const out: ChatMessage[] = []
  if (system) out.push({ role: 'system', content: system })

  for (const msg of messages) {
    const blocks: ContentBlockParam[] =
      typeof msg.content === 'string'
        ? [{ type: 'text', text: msg.content }]
        : msg.content

    if (msg.role === 'assistant') {
      const text = blocks
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('')
      const reasoning = blocks
        .filter(b => b.type === 'thinking')
        .map(b => (b as { thinking: string }).thinking)
        .join('')
      const toolCalls: ChatToolCall[] = blocks
        .filter(b => b.type === 'tool_use')
        .map(b => {
          const t = b as { id: string; name: string; input: unknown }
          return {
            id: t.id,
            type: 'function',
            function: {
              name: t.name,
              arguments: typeof t.input === 'string' ? t.input : JSON.stringify(t.input ?? {}),
            },
          }
        })
      const prev = out.at(-1)
      if (prev?.role === 'assistant' && !prev.tool_calls?.length) {
        // Merge consecutive assistant turns (the loop splits one reply per block).
        prev.content = (prev.content ?? '') + text || null
        if (reasoning && reasoningField) prev[reasoningField] = (prev[reasoningField] ?? '') + reasoning
        if (toolCalls.length) prev.tool_calls = toolCalls
        continue
      }
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length && { tool_calls: toolCalls }),
        ...(reasoning && reasoningField && { [reasoningField]: reasoning }),
      })
      continue
    }

    // user: tool results first (they must directly follow the tool_calls), then text.
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue
      const text = toolResultText(b.content)
      out.push({
        role: 'tool',
        tool_call_id: b.tool_use_id,
        content: (b.is_error ? `Error: ${text}` : text) || '(no output)',
      })
    }
    const text = blocks
      .filter(b => b.type !== 'tool_result')
      .map(blockText)
      .filter(Boolean)
      .join('\n\n')
    if (!text) continue
    const prev = out.at(-1)
    if (prev?.role === 'user') prev.content += `\n\n${text}`
    else out.push({ role: 'user', content: text })
  }
  return out
}

export function toChatTools(tools: BetaToolUnion[]): ChatTool[] {
  return tools
    .filter((t): t is Extract<BetaToolUnion, { input_schema: unknown }> => 'input_schema' in t)
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description && { description: t.description }),
        parameters: t.input_schema,
      },
    }))
}

export type ChatRequest = {
  model: string
  system: string
  messages: MessageParam[]
  tools: BetaToolUnion[]
  maxTokens: number
  temperature?: number
  toolChoice?: { type: 'auto' } | { type: 'tool'; name: string }
  jsonOutput?: boolean
}

function buildBody(req: ChatRequest, stream: boolean, provider: string): Record<string, unknown> {
  const tools = toChatTools(req.tools)
  return {
    model: req.model,
    messages: toChatMessages(req.system, req.messages, reasoningFieldFor(provider)),
    ...(tools.length && { tools }),
    ...(tools.length &&
      req.toolChoice?.type === 'tool' && {
        tool_choice: { type: 'function', function: { name: req.toolChoice.name } },
      }),
    max_tokens: req.maxTokens,
    ...(req.temperature !== undefined && { temperature: req.temperature }),
    ...(req.jsonOutput && { response_format: { type: 'json_object' } }),
    stream,
    ...(stream && { stream_options: { include_usage: true } }),
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

async function post(
  provider: ResolvedProvider,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey && { authorization: `Bearer ${provider.apiKey}` }),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw new APIUserAbortError()
    const e = error as Error
    if (e.name === 'TimeoutError') throw new APIConnectionTimeoutError()
    throw new APIConnectionError({ message: `Connection error: ${e.message}`, cause: e })
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {}
    const detail =
      (parsed as { error?: { message?: string } })?.error?.message ??
      (parsed as { message?: string })?.message ??
      text.slice(0, 500)
    throw makeAPIError(
      response.status,
      parsed,
      `${response.status} ${detail || response.statusText}`,
      response.headers,
    )
  }
  return response
}

/**
 * POST with auth-failure fallthrough: when the provider was auto-detected from a
 * bare key, a 401/403 moves on to the next candidate endpoint (DeepSeek, then
 * Qwen regions). Returns the response and the endpoint that accepted the key.
 */
async function postWithDetection(
  provider: ResolvedProvider,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ response: Response; provider: ResolvedProvider }> {
  let current = provider
  for (;;) {
    try {
      const response = await post(current, { ...body, model: current.model }, signal)
      if (provider.fallbacks.length || current !== provider) {
        rememberDetectedEndpoint(current.provider, current.baseUrl)
      }
      return { response, provider: current }
    } catch (error) {
      const status = (error as { status?: number }).status
      const next = current.fallbacks[0]
      if ((status === 401 || status === 403) && next) {
        current = withEndpoint(current, next)
        continue
      }
      if ((status === 401 || status === 403) && current !== provider) {
        // Every auto-detect candidate refused the key: say so, not just the last one's error.
        throw makeAPIError(
          status,
          (error as { error?: unknown }).error,
          `${status} AI_API_KEY was rejected by DeepSeek and by Qwen (international, US and China endpoints). Check the key, or pin the provider with AI_PROVIDER / AI_BASE_URL.`,
        )
      }
      throw error
    }
  }
}

// ── Response side ────────────────────────────────────────────────────────────

type ChatUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

function mapUsage(u: ChatUsage | undefined) {
  const cached = u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0
  return {
    input_tokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
    output_tokens: u?.completion_tokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  }
}

export function mapFinishReason(reason: string | null | undefined): BetaStopReason | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    case null:
    case undefined:
      return null
    default:
      return 'end_turn'
  }
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
}

type ChunkDelta = {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  reasoning_details?: { type?: string; text?: string }[] | null
  tool_calls?: {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

/**
 * Streams one completion as Anthropic-shaped events. The final
 * `message_delta` carries stop_reason and usage.
 */
export async function* streamChatCompletion(
  provider: ResolvedProvider,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<BetaRawMessageStreamEvent, { provider: ResolvedProvider }> {
  const { response, provider: used } = await postWithDetection(
    provider,
    buildBody(req, true, provider.provider),
    signal,
  )
  const id = response.headers.get('x-request-id') ?? `msg_${Date.now().toString(36)}`
  yield {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: used.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }

  let index = -1
  type OpenBlock = { kind: 'text' | 'thinking' | 'tool'; toolIndex?: number }
  let open: OpenBlock | null = null
  // Reassigned inside the generator helpers, so read it through a function (TS narrows `open` to null otherwise).
  const current = (): OpenBlock | null => open
  let finish: string | null | undefined
  let usage: ChatUsage | undefined
  const close = function* (): Generator<BetaRawMessageStreamEvent> {
    if (open) yield { type: 'content_block_stop', index }
    open = null
  }
  const start = function* (
    kind: 'text' | 'thinking' | 'tool',
    block: BetaContentBlock,
    toolIndex?: number,
  ): Generator<BetaRawMessageStreamEvent> {
    yield* close()
    index++
    open = { kind, toolIndex }
    yield { type: 'content_block_start', index, content_block: block }
  }

  try {
    for await (const data of sseData(response.body!)) {
      if (data === '[DONE]') break
      if (!data) continue
      let chunk: {
        choices?: { delta?: ChunkDelta; finish_reason?: string | null }[]
        usage?: ChatUsage
        error?: { message?: string }
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) throw makeAPIError(500, chunk, chunk.error.message ?? 'Stream error')
      if (chunk.usage) usage = chunk.usage
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}

      const reasoningText =
        delta.reasoning_content ??
        delta.reasoning ??
        delta.reasoning_details
          ?.filter(d => d.type === 'reasoning.text' && d.text)
          .map(d => d.text)
          .join('')
      if (reasoningText) {
        if (current()?.kind !== 'thinking') {
          yield* start('thinking', { type: 'thinking', thinking: '', signature: '' })
        }
        yield {
          type: 'content_block_delta',
          index,
          delta: { type: 'thinking_delta', thinking: reasoningText },
        }
      }
      if (delta.content) {
        if (current()?.kind !== 'text') {
          yield* start('text', { type: 'text', text: '' })
        }
        yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: delta.content } }
      }
      for (const call of delta.tool_calls ?? []) {
        const toolIndex = call.index ?? 0
        if (current()?.kind !== 'tool' || current()?.toolIndex !== toolIndex) {
          yield* start(
            'tool',
            {
              type: 'tool_use',
              id: call.id || `call_${Date.now().toString(36)}_${toolIndex}`,
              name: call.function?.name ?? '',
              input: '',
            },
            toolIndex,
          )
        }
        if (call.function?.arguments) {
          yield {
            type: 'content_block_delta',
            index,
            delta: { type: 'input_json_delta', partial_json: call.function.arguments },
          }
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }
  } catch (error) {
    if (signal.aborted) throw new APIUserAbortError()
    if (error instanceof Error && !('status' in error)) {
      throw new APIConnectionError({ message: `Stream interrupted: ${error.message}`, cause: error })
    }
    throw error
  }

  yield* close()
  const stop = mapFinishReason(finish) ?? (index >= 0 ? 'end_turn' : null)
  yield {
    type: 'message_delta',
    delta: { stop_reason: stop, stop_sequence: null },
    usage: mapUsage(usage),
  }
  yield { type: 'message_stop' }
  return { provider: used }
}

/** Minimal non-streaming call for key checks and small side queries. */
export async function completeText(
  provider: ResolvedProvider,
  req: ChatRequest,
  signal: AbortSignal,
): Promise<string> {
  const { response } = await postWithDetection(provider, buildBody(req, false, provider.provider), signal)
  const json = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[]
  }
  return json.choices?.[0]?.message?.content ?? ''
}

/** Runs a streamed completion to the end and returns it as one message (side queries). */
export async function collectMessage(
  provider: ResolvedProvider,
  req: ChatRequest,
  signal: AbortSignal,
): Promise<import('./types.js').BetaMessage> {
  let message: import('./types.js').BetaMessage | undefined
  const blocks: Record<string, unknown>[] = []
  for await (const ev of streamChatCompletion(provider, req, signal)) {
    if (ev.type === 'message_start') message = ev.message
    else if (ev.type === 'content_block_start') blocks[ev.index] = { ...ev.content_block }
    else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index]!
      const d = ev.delta
      if (d.type === 'text_delta') b.text = (b.text as string) + d.text
      else if (d.type === 'thinking_delta') b.thinking = (b.thinking as string) + d.thinking
      else if (d.type === 'input_json_delta') b.input = (b.input as string) + d.partial_json
    } else if (ev.type === 'message_delta' && message) {
      message.stop_reason = ev.delta.stop_reason
      message.usage = { ...message.usage, ...ev.usage } as typeof message.usage
    }
  }
  for (const b of blocks) {
    if (b.type === 'tool_use') {
      try {
        b.input = JSON.parse((b.input as string) || '{}')
      } catch {
        b.input = {}
      }
    }
  }
  return { ...message!, content: blocks as unknown as BetaContentBlock[] }
}
