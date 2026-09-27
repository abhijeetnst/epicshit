import { afterEach, expect, test } from 'bun:test'
import { rememberDetectedEndpoint, resolveProvider } from '../providerConfig.js'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
  rememberDetectedEndpoint(null)
})

test('a detected Qwen region is reused on later requests even when AI_MODEL pins qwen', () => {
  process.env = { AI_API_KEY: 'test-key', AI_MODEL: 'qwen-plus' }
  const first = resolveProvider()!
  expect(first.baseUrl).toContain('dashscope-intl')
  expect(first.fallbacks.length).toBe(2)

  const us = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'
  rememberDetectedEndpoint('qwen', us)
  const next = resolveProvider()!
  expect(next.baseUrl).toBe(us)
  expect(next.model).toBe('qwen-plus')
})

test('sk-or- keys route to OpenRouter', () => {
  process.env = { AI_API_KEY: 'sk-or-test' }
  expect(resolveProvider()!.provider).toBe('openrouter')
})
