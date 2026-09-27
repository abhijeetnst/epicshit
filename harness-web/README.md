# DopeCode

A browser UI for DopeCode, the local coding agent: pick a folder, run several
sessions side by side in tabs, bring your own API keys (DeepSeek, Qwen, or any
OpenAI-compatible endpoint), and watch a pixel crab per tab act out what each
session is doing. It talks to the agent over a small HTTP + SSE protocol
([PROTOCOL.md](PROTOCOL.md)). The real agent is DopeCode itself
(`../src/server/agent/server.ts`); `mock-agent/` is kept as a canned stand-in for
UI work and never calls a model.

## Run it

Build DopeCode once from the repo root (`make setup`), then:

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:3000>. `npm run dev` starts the DopeCode agent
(`dope agent`, on `127.0.0.1:4096`) and the web app on `127.0.0.1:3000`.
You can also start everything from inside the TUI: type `/web` in `dope`.
`npm run dev:agent` / `npm run dev:web` run one half, and `npm run dev:mock`
runs the web app against the mock agent instead.

If `AI_API_KEY` is set in the environment (or in `.env.local`), DeepSeek and
Qwen show up as configured with that key; otherwise add a key in the UI.

1. **Open a folder.** Click the folder chip under the prompt, or press ⌥O
   (Alt+O). The picker lists real folders on this machine through the agent.
   You can also type a path (`~/code/app`).
2. **Add a key.** Click **Add API key** (top right, ⌥K) and paste a key for
   DeepSeek, Qwen (Alibaba Cloud Model Studio), OpenAI or OpenRouter, or give a
   base URL for any OpenAI-compatible server (vLLM, Ollama, LM Studio). Qwen keys
   are region-bound: set the base URL to `https://dashscope-us.aliyuncs.com/compatible-mode/v1`
   (US) or `https://dashscope.aliyuncs.com/compatible-mode/v1` (China) if the
   default international endpoint rejects your key. Keys are stored by the agent
   in `~/.dope/providers.json` (mode 0600), never in the browser.
3. **Prompt.** Enter sends; Shift+Enter adds a new line; Esc stops a running
   turn. Each turn runs the full DopeCode loop in that folder (plan.md,
   todo.md, tools, and the test-and-fix loop). File edits and shell commands in
   the chosen folder are allowed without prompts, because the web UI has no
   permission dialog.
4. **More sessions.** **+** (⌥T) opens another tab on the same folder. Tabs run
   in parallel. The grid button (⌥S) lists every folder and session so you
   can reopen or delete them.

## Crabs

There is exactly one crab per open session: three session tabs, three crabs;
open a fourth and a fourth crab drops in. Each crab is numbered like its tab.
They follow the spirit of [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents).
Crabs drop in from the top when a tab opens and
roam the screen edges: along the floor, up the side walls, across the ceiling,
and onto the prompt box. Each one mirrors its session:

| The crab… | When the session is… |
| --- | --- |
| scuttles to its desk spot and types on a laptop | streaming a reply, or running a command/edit tool |
| holds up a page, eyes scanning | running a read-only tool (`read`, `list`, `grep`, …) |
| looks up under a "thinking" bubble | waiting for the model's first token |
| hops with a "✓ done" bubble | finishing a turn |
| goes dizzy with "! error" | ending in an error |
| naps (z…) | idle for two minutes, or the agent is offline |

Hover a crab for its session, folder and status; click it to open its tab;
drag it to pick it up and fling it. The crab button in the top bar (⌥C) shows
the count (×3), turns them off and on, sets their size (S 32×20, M 48×30,
L 64×40 px), and has an optional chime for when a background tab finishes.
Crabs start off for people with "reduce motion" set.

The crab sprite is an original pixel-art character for DopeCode. Swap
`components/crabs/sprites.ts` for your own character before you ship DopeCode
publicly.

## Where your keys go

The key field sends the key once, through this app's `/api/agent` proxy, to
the local agent. The agent stores it (the mock uses
`~/.dopecode-mock/auth.json`, mode `0600`) and only ever sends back the last
four characters. The browser keeps nothing but the tab layout, the chosen model and display
settings in `localStorage`, and the web app doesn't log or store keys.

Both servers bind to `127.0.0.1`. The proxy only serves same-origin requests
to a local hostname, and the agent rejects any request that comes straight
from a browser page. See *Transport and security* in
[PROTOCOL.md](PROTOCOL.md).

## Plugging in the real agent

Serve the endpoints in [PROTOCOL.md](PROTOCOL.md) from your harness, then point
the web app at it:

```bash
DOPECODE_AGENT_URL=http://127.0.0.1:5000 npm run dev:web
```

The protocol's JSON types live in [`lib/protocol.ts`](lib/protocol.ts). Import
them if your agent is TypeScript, or mirror them.

## Settings

Put these in `.env.local` (see `.env.example`). The web app and the mock agent
both read that file.

| Variable | Used by | Default |
| --- | --- | --- |
| `DOPECODE_AGENT_URL` | web | `http://127.0.0.1:4096` |
| `DOPECODE_AGENT_TOKEN` | both | unset. When set, the proxy sends it as a bearer token and the agent requires it |
| `DOPECODE_WEB_ALLOWED_HOSTS` | web | unset. Extra hostnames allowed to use the app, comma-separated |
| `DOPECODE_AGENT_PORT` | mock | `4096` |
| `DOPECODE_DATA_DIR` | mock | `~/.dopecode-mock` (`state.json`, `auth.json`) |

## Layout

```
app/api/agent/[...path]/route.ts  proxy to the agent (host/origin checks, SSE passthrough)
lib/protocol.ts                   wire types shared by UI and mock
lib/api.ts                        typed client + the single EventSource
lib/store.ts                      zustand store: tabs, sessions, messages, providers
components/                       tab bar, composer, thread, folder picker, keys, sessions
components/crabs/                 crab sprites, the crab engine (movement + session states), menu
mock-agent/                       the stand-in agent (Node http server, run with tsx)
```

## Scripts

`npm run dev`, `npm run build`, `npm start` (the mock agent and the built web
app together), `npm run lint`, `npm run typecheck`.
