import { afterAll, expect, test } from 'bun:test'
import { reasoningFieldFor, streamChatCompletion, toChatMessages } from '../openaiCompat.js'
import type { ResolvedProvider } from '../providerConfig.js'

// Two fake endpoints: "a" rejects the key (like DeepSeek with a Qwen key), "b" accepts it.
const seen: { server: string; body: any }[] = []
const serve = (name: string, ok: boolean) =>
  Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push({ server: name, body: await req.json() })
      if (!ok) return Response.json({ error: { message: 'Authentication Fails' } }, { status: 401 })
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`
      return new Response(
        chunk({ reasoning_content: 'think' }) +
          chunk({ content: 'hi' }) +
          chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'Bash', arguments: '{"command":' } }] }) +
          chunk({ tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }) +
          chunk({}, 'tool_calls') +
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, prompt_cache_hit_tokens: 4 } })}\n\n` +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
const a = serve('a', false)
const b = serve('b', true)
afterAll(() => {
  a.stop(true)
  b.stop(true)
})

const provider: ResolvedProvider = {
  provider: 'deepseek',
  baseUrl: `http://127.0.0.1:${a.port}`,
  apiKey: 'sk-x',
  model: 'deepseek-flash',
  fallbacks: [{ provider: 'qwen', baseUrl: `http://127.0.0.1:${b.port}` }],
  source: 'env',
  contextWindow: 1000,
  maxOutputTokens: 100,
}

test('maps internal messages to chat messages, keeping reasoning and tool pairing', () => {
  const out = toChatMessages('sys', [
    { role: 'user', content: 'do it' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'plan', signature: '' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'a.txt' },
        { type: 'text', text: 'next' },
      ],
    },
  ])
  expect(out.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
  expect(out[2]).toMatchObject({ reasoning_content: 'plan', tool_calls: [{ id: 't1', function: { name: 'Bash' } }] })
  expect(out[3]).toMatchObject({ tool_call_id: 't1', content: 'a.txt' })
})

test('streams chunks as block events and falls through to the next endpoint on 401', async () => {
  const events: any[] = []
  const gen = streamChatCompletion(
    provider,
    { model: 'x', system: '', messages: [{ role: 'user', content: 'q' }], tools: [], maxTokens: 50 },
    new AbortController().signal,
  )
  let r = await gen.next()
  while (!r.done) {
    events.push(r.value)
    r = await gen.next()
  }
  expect(r.value.provider.provider).toBe('qwen')
  expect(seen.map(s => s.server)).toEqual(['a', 'b'])
  expect(seen[1]!.body.model).toBe('qwen-plus') // provider switch resets to its default model
  const starts = events.filter(e => e.type === 'content_block_start').map(e => e.content_block.type)
  expect(starts).toEqual(['thinking', 'text', 'tool_use'])
  const delta = events.find(e => e.type === 'message_delta')
  expect(delta.delta.stop_reason).toBe('tool_use')
  expect(delta.usage).toMatchObject({ input_tokens: 6, output_tokens: 3, cache_read_input_tokens: 4 })
  const args = events
    .filter(e => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta')
    .map(e => e.delta.partial_json)
    .join('')
  expect(JSON.parse(args)).toEqual({ command: 'ls' })
})

test('sends prior reasoning back in the field each provider expects', () => {
  const history = [
    { role: 'user' as const, content: 'q' },
    { role: 'assistant' as const, content: [{ type: 'thinking' as const, thinking: 'hmm', signature: '' }, { type: 'text' as const, text: 'a' }] },
  ]
  expect(toChatMessages('', history, reasoningFieldFor('deepseek'))[1]).toMatchObject({ reasoning_content: 'hmm' })
  expect(toChatMessages('', history, reasoningFieldFor('openrouter'))[1]).toMatchObject({ reasoning: 'hmm' })
  expect(toChatMessages('', history, reasoningFieldFor('openai'))[1]).not.toHaveProperty('reasoning_content')
})
