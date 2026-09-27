import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// An OpenRouter key in AI_API_KEY belongs to OpenRouter (as in resolveProvider), not DeepSeek/Qwen:
// the web turn would otherwise send it to api.deepseek.com and get a 401.
process.env.DOPE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'dope-providers-'))
process.env.AI_API_KEY = 'sk-or-v1-fake0000'
for (const k of ['AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'DOPECODE_AGENT_TOKEN']) delete process.env[k]

const { startAgentServer, stopAgentServer } = await import('../server.js')
afterAll(stopAgentServer)

test('an sk-or- AI_API_KEY is offered under OpenRouter only', async () => {
  const { url } = await startAgentServer(0)
  const providers = (await (await fetch(`${url}/providers`)).json()) as { id: string; configured: boolean }[]
  expect(providers.filter(p => p.configured).map(p => p.id)).toEqual(['openrouter'])
})
