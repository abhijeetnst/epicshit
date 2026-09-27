// Retry policy for model requests. Provider-agnostic: the operation receives
// the attempt number and does its own HTTP call; we retry rate limits (429),
// overloads/5xx and connection errors with jittered exponential backoff,
// honoring retry-after. Everything else fails fast.
import type { SystemAPIErrorMessage } from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { createSystemAPIErrorMessage } from 'src/utils/messages.js'
import { sleep } from '../../utils/sleep.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from './types.js'

export const BASE_DELAY_MS = 500
const DEFAULT_MAX_RETRIES = 8

export interface RetryContext {
  model: string
  thinkingConfig: ThinkingConfig
  maxTokensOverride?: number
}

type RetryOptions = {
  model: string
  thinkingConfig: ThinkingConfig
  maxRetries?: number
  signal?: AbortSignal
}

export class CannotRetryError extends Error {
  constructor(
    readonly originalError: unknown,
    readonly retryContext: RetryContext,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError))
    this.name = 'CannotRetryError'
    if (originalError instanceof Error && originalError.stack) this.stack = originalError.stack
  }
}

/** Kept for query.ts, which catches it; nothing throws it without a fallback model. */
export class FallbackTriggeredError extends Error {
  constructor(
    readonly originalModel: string,
    readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}

export function getDefaultMaxRetries(): number {
  const n = parseInt(process.env.DOPE_CODE_MAX_RETRIES || '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_RETRIES
}

export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) return seconds * 1000
  }
  const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), maxDelayMs)
  return baseDelay + Math.random() * 0.25 * baseDelay
}

export function is529Error(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.status === 529 || (error.message?.includes('"type":"overloaded_error"') ?? false))
  )
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof APIUserAbortError) return false
  if (error instanceof APIConnectionError) return true
  if (!(error instanceof APIError)) return false
  const status = error.status
  if (status === undefined) return true
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export async function* withRetry<T>(
  operation: (attempt: number, context: RetryContext) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T> {
  const maxRetries = options.maxRetries ?? getDefaultMaxRetries()
  const context: RetryContext = {
    model: options.model,
    thinkingConfig: options.thinkingConfig,
  }
  for (let attempt = 1; ; attempt++) {
    if (options.signal?.aborted) throw new APIUserAbortError()
    try {
      return await operation(attempt, context)
    } catch (error) {
      if (attempt > maxRetries || !shouldRetry(error) || options.signal?.aborted) {
        throw new CannotRetryError(error, context)
      }
      const retryAfter = error instanceof APIError ? error.headers?.get?.('retry-after') : null
      const delayMs = getRetryDelay(attempt, retryAfter)
      logForDebugging(`API error (attempt ${attempt}/${maxRetries + 1}), retrying in ${delayMs}ms: ${String(error)}`)
      if (error instanceof APIError) {
        yield createSystemAPIErrorMessage(error, delayMs, attempt, maxRetries)
      }
      await sleep(delayMs, options.signal, { abortError: () => new APIUserAbortError() })
    }
  }
}
