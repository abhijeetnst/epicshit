// Internal conversation wire types.
//
// The agent loop (messages, tools, compaction, transcripts) is built around
// block-based content: text / image / tool_use / tool_result / thinking blocks,
// plus streaming events shaped like message_start / content_block_delta.
// DopeCode owns these message and stream types; the
// OpenAI-compatible adapter (openaiProvider.ts) translates to/from them.

// ── Content blocks: request side ────────────────────────────────────────────

export type CacheControlEphemeral = { type: 'ephemeral'; ttl?: '5m' | '1h' }

export type TextCitationParam = Record<string, unknown>

export type TextBlockParam = {
  type: 'text'
  text: string
  cache_control?: CacheControlEphemeral | null
  citations?: TextCitationParam[] | null
}

export type Base64ImageSource = {
  type: 'base64'
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  data: string
}

export type URLImageSource = { type: 'url'; url: string }

export type ImageBlockParam = {
  type: 'image'
  source: Base64ImageSource | URLImageSource
  cache_control?: CacheControlEphemeral | null
}

export type BetaRequestDocumentBlock = {
  type: 'document'
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
    | { type: 'url'; url: string }
  title?: string | null
  context?: string | null
  cache_control?: CacheControlEphemeral | null
}

export type ToolUseBlockParam = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
  cache_control?: CacheControlEphemeral | null
}

export type ToolResultBlockParam = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<TextBlockParam | ImageBlockParam | BetaRequestDocumentBlock>
  is_error?: boolean
  cache_control?: CacheControlEphemeral | null
}

export type ThinkingBlockParam = {
  type: 'thinking'
  thinking: string
  signature: string
}

export type RedactedThinkingBlockParam = {
  type: 'redacted_thinking'
  data: string
}

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | BetaRequestDocumentBlock
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam

export type MessageParam = {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

// ── Content blocks: response side ───────────────────────────────────────────

export type TextBlock = {
  type: 'text'
  text: string
  citations?: unknown[] | null
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature: string
}

export type RedactedThinkingBlock = {
  type: 'redacted_thinking'
  data: string
}

// Server-side tool blocks (web search etc.) are kept loose: no OpenAI-compatible
// provider emits them, but transcripts and renderers still switch on them.
export type ServerToolBlock = {
  type:
    | 'server_tool_use'
    | 'mcp_tool_use'
    | 'web_search_tool_result'
    | 'advisor_tool_result'
    | 'connector_text'
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock

// ── "Beta" aliases (the loop historically used the beta namespace) ──────────

export type BetaTextBlock = TextBlock
export type BetaToolUseBlock = ToolUseBlock
export type BetaThinkingBlock = ThinkingBlock
export type BetaRedactedThinkingBlock = RedactedThinkingBlock
export type BetaContentBlock = ContentBlock | ServerToolBlock
export type BetaContentBlockParam = ContentBlockParam
export type BetaImageBlockParam = ImageBlockParam
export type BetaToolResultBlockParam = ToolResultBlockParam
export type BetaMessageParam = MessageParam

export type BetaStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded'

export type BetaUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
  server_tool_use?: { web_search_requests: number } | null
  service_tier?: 'standard' | 'priority' | 'batch' | null
  cache_creation?: {
    ephemeral_1h_input_tokens: number
    ephemeral_5m_input_tokens: number
  } | null
}

export type BetaMessageDeltaUsage = {
  output_tokens: number
  input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: { web_search_requests: number } | null
}

export type BetaMessage = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: BetaContentBlock[]
  stop_reason: BetaStopReason | null
  stop_sequence: string | null
  usage: BetaUsage
  container?: unknown
  context_management?: unknown
}

// ── Tools ───────────────────────────────────────────────────────────────────

export type ToolInputSchema = {
  type: 'object'
  properties?: unknown | null
  required?: string[] | null
  [k: string]: unknown
}

export type BetaTool = {
  name: string
  description?: string
  input_schema: ToolInputSchema
  cache_control?: CacheControlEphemeral | null
  strict?: boolean
  defer_loading?: boolean
  type?: 'custom' | null
}

export type BetaWebSearchTool20250305 = {
  type: 'web_search_20250305'
  name: 'web_search'
  allowed_domains?: string[] | null
  blocked_domains?: string[] | null
  max_uses?: number | null
  cache_control?: CacheControlEphemeral | null
}

export type BetaToolUnion = BetaTool | BetaWebSearchTool20250305

export type BetaToolChoiceAuto = { type: 'auto'; disable_parallel_tool_use?: boolean }
export type BetaToolChoiceTool = {
  type: 'tool'
  name: string
  disable_parallel_tool_use?: boolean
}
export type BetaToolChoice =
  | BetaToolChoiceAuto
  | BetaToolChoiceTool
  | { type: 'any' | 'none'; disable_parallel_tool_use?: boolean }

export type BetaJSONOutputFormat = { type: 'json_schema'; schema: Record<string, unknown> }
export type BetaOutputConfig = { format?: BetaJSONOutputFormat | null; effort?: string | null }

export type BetaThinkingConfigParam =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' }

export type BetaMessageStreamParams = {
  model: string
  max_tokens: number
  messages: BetaMessageParam[]
  system?: string | TextBlockParam[]
  tools?: BetaToolUnion[]
  tool_choice?: BetaToolChoice
  temperature?: number
  thinking?: BetaThinkingConfigParam
  stop_sequences?: string[]
  metadata?: { user_id?: string | null }
  betas?: string[]
  output_format?: BetaJSONOutputFormat | null
  output_config?: BetaOutputConfig
  [k: string]: unknown
}

// ── Streaming events ────────────────────────────────────────────────────────

export type BetaRawContentBlockDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string }
  | { type: 'citations_delta'; citation: unknown }

export type BetaRawMessageStreamEvent =
  | { type: 'message_start'; message: BetaMessage }
  | {
      type: 'message_delta'
      delta: { stop_reason: BetaStopReason | null; stop_sequence: string | null }
      usage: BetaMessageDeltaUsage
      context_management?: unknown
    }
  | { type: 'message_stop' }
  | { type: 'content_block_start'; index: number; content_block: BetaContentBlock }
  | { type: 'content_block_delta'; index: number; delta: BetaRawContentBlockDelta }
  | { type: 'content_block_stop'; index: number }

// ── Errors ──────────────────────────────────────────────────────────────────
// Same class names/shape the retry and error-message code already switches on.

export class APIError extends Error {
  readonly status: number | undefined
  readonly headers: Headers | undefined
  readonly error: unknown
  readonly requestID: string | null | undefined
  constructor(
    status: number | undefined,
    error: unknown,
    message: string | undefined,
    headers?: Headers,
  ) {
    super(message ?? `${status ?? ''} API error`.trim())
    this.name = 'APIError'
    this.status = status
    this.error = error
    this.headers = headers
    this.requestID = headers?.get('x-request-id')
  }
}

export class APIUserAbortError extends APIError {
  constructor(message = 'Request was aborted.') {
    super(undefined, undefined, message)
    this.name = 'APIUserAbortError'
  }
}

export class APIConnectionError extends APIError {
  constructor({ message, cause }: { message?: string; cause?: Error } = {}) {
    super(undefined, undefined, message ?? 'Connection error.')
    this.name = 'APIConnectionError'
    if (cause) (this as { cause?: unknown }).cause = cause
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? 'Request timed out.' })
    this.name = 'APIConnectionTimeoutError'
  }
}

export class AuthenticationError extends APIError {}
export class NotFoundError extends APIError {}

/** Build the right error subclass for an HTTP failure. */
export function makeAPIError(
  status: number,
  body: unknown,
  message: string,
  headers?: Headers,
): APIError {
  if (status === 401) return new AuthenticationError(status, body, message, headers)
  if (status === 404) return new NotFoundError(status, body, message, headers)
  return new APIError(status, body, message, headers)
}
