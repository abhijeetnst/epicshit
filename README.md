# DopeCode

DopeCode is a terminal coding agent (an **AI Harness**) with an interactive TUI, a
web command center, and a self-correcting fix/test loop. It runs on your machine
and talks to **DeepSeek** or **Qwen**, or to any OpenAI-compatible endpoint. You
bring your own key, and it is only sent to the provider you choose.

- [Quick start](#quick-start-evaluators)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running DopeCode](#running-dopecode)
- [Installing the `dope` command](#installing-the-dope-command-on-your-system)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Web command center](#web-command-center)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

## Quick start (evaluators)

```bash
git clone <this repo> && cd <this repo>
export AI_API_KEY="<provided key>"
make setup   # installs everything and builds the CLI
make run     # launches the DopeCode TUI
```

On first launch, press **Enter** to accept the default on each first-run screen
(colour theme, trust this folder). Then paste the GitHub issue or test case into the prompt as text and
press Enter.

| Command | What it does |
| --- | --- |
| `make setup` | Checks for `git`. Installs bun 1.4.2 (to `~/.bun`) and ripgrep if they are missing. Runs `bun install` and builds `dist/cli.mjs`. |
| `make run` | Launches the interactive TUI in this folder. `make run DIR=/path/to/repo` runs it inside another checkout, such as the evaluation repository. |
| `make test` | Runs the test suite (`bun test`), then checks that the built CLI starts. |
| `make clean` | Removes the generated artefacts: `dist/` and `node_modules/`. |
| `make install` | Puts a `dope` command on your PATH (see [below](#installing-the-dope-command-on-your-system)). |

## Requirements

- macOS or Linux (on Windows, use WSL).
- `git` and `curl`, which the evaluation environment already has.
- An API key for DeepSeek, Qwen (Alibaba Cloud Model Studio) or OpenRouter.

`make setup` installs everything else: [bun](https://bun.sh) 1.4.2 (only if
bun is missing), [ripgrep](https://github.com/BurntSushi/ripgrep) through
brew/apt/dnf/apk (only if `rg` is missing), and the JavaScript dependencies,
which are pinned by `bun.lock`.

## Installation

```bash
# 1. Get the code
git clone <this repo>
cd <this repo>

# 2. Provide your key (the only credential; it is read from the environment)
export AI_API_KEY="<your DeepSeek, Qwen or OpenRouter key>"

# 3. Install dependencies and build
make setup
```

`make setup` ends with `Setup complete. Start the harness with: make run`. The
build output is a single file, `dist/cli.mjs`.

To keep the key across terminal sessions, add the `export AI_API_KEY=...` line to
your `~/.zshrc` or `~/.bashrc`. Do not put it in any file inside this repository.

## Running DopeCode

### Interactive TUI

```bash
make run                          # work on this folder
make run DIR=~/code/some-project  # work on another project
```

- Type a task in plain English, or paste a GitHub issue, and press Enter.
  DopeCode plans, edits files, runs commands and tests, and reports back.
- Press **Esc** to interrupt the agent and **Ctrl+C** twice to quit.
- Useful slash commands:

  | Command | What it does |
  | --- | --- |
  | `/help` | List the commands |
  | `/model` | Switch model |
  | `/clear` | Start a fresh conversation |
  | `/compact` | Summarise the conversation to free up context |
  | `/resume` | Reopen an earlier session |
  | `/init` | Write a `DOPE.md` with project notes for the agent |
  | `/session [folder]` | Open a second DopeCode in a new terminal window |
  | `/web` | Start the web command center |

### One-shot (non-interactive) mode

`-p` runs a single task and prints the result, which is useful for scripts and CI:

```bash
bun dist/cli.mjs -p "fix the failing test in tests/test_math.py" \
  --permission-mode acceptEdits --allowedTools "Read,Write,Edit,Grep,Glob,Bash"
bun dist/cli.mjs -p "summarise this repo" --output-format json
```

## Installing the `dope` command on your system

```bash
make install        # creates ~/.local/bin/dope -> <repo>/dist/cli.mjs
dope                # run it from any project folder
make uninstall      # removes the command
```

If `~/.local/bin` is not on your PATH, `make install` prints the line to add to
your shell profile. Use `make install BIN_DIR=/some/other/bin` to choose another
directory. The command is a symlink to the built CLI, so run `make setup` again
after pulling changes to rebuild it.

## Configuration

### Credentials

`AI_API_KEY` is the **only** credential, and it is always read from the environment.
No key, token or password is stored in the source, the Makefile, `.env` files, the
docs or any committed config. `.env.example` lists the variables with empty
values. The Makefile never prints the key.

### Model configuration

The providers and their default models are defined in
[`src/services/api/providerConfig.ts`](src/services/api/providerConfig.ts)
(`PROVIDER_CATALOG`). Override them from the environment to use a prescribed
model without editing any code:

| Variable | Meaning | Example |
| --- | --- | --- |
| `AI_PROVIDER` | `deepseek`, `qwen`, `openrouter`, `openai`, `openai-compatible` | `qwen` |
| `AI_MODEL` | model id | `deepseek-v4-pro`, `qwen3-coder-plus` |
| `AI_BASE_URL` | endpoint override | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` |
| `AI_MAX_TOKENS` | max output tokens per response | `32000` |

Defaults when only `AI_API_KEY` is set:

| Provider | Endpoint | Default model | Other models |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | `deepseek-v4-pro` |
| Qwen (Model Studio) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (then the US and China regions) | `qwen-plus` | `qwen3-coder-plus`, `qwen-max` |
| OpenRouter (for testing; `sk-or-` keys) | `https://openrouter.ai/api/v1` | `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-pro`, `qwen/qwen3-coder-plus` |

With only a key, DopeCode detects the provider. `sk-or-` keys go to OpenRouter.
Any other key is tried against DeepSeek, then Qwen (international, US, then China),
and the first endpoint that accepts it is kept. `OPENAI_API_KEY`,
`OPENAI_BASE_URL` and `OPENAI_MODEL` are accepted as aliases.

### Other settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOPE_TEST_CMD` | detected | Test command for the self-correcting loop |
| `DOPE_VERIFY_MAX_ITERATIONS` | `3` | Maximum fix/test rounds before stopping |
| `DOPE_CONFIG_DIR` | `~/.dope` | Where keys saved from the web UI are stored |
| `DOPECODE_AGENT_TOKEN` | unset | Bearer token that the web agent API requires |

### Text-only

The harness sends only text to the model. Inputs, tool results and file reads are
text; if an image turns up (for example a `.png` read from the repository), the
adapter replaces it with a text placeholder. No image, audio or video input is needed.

### Reproducibility

- The main agent loop does not set `temperature`, `top_p` or a seed, so its requests
  use the provider's defaults for the configured model. Only two small internal hook
  queries pin `temperature: 0`.
- The self-correcting loop stops after `DOPE_VERIFY_MAX_ITERATIONS` rounds.
- Dependency versions are pinned by `bun.lock`, and `make setup` installs bun 1.4.2
  when bun is missing.

## How it works

- **Plan first.** For a new coding task the agent writes `plan.md` (goal, files,
  steps, verification command) before anything else.
- **Live todo list.** The agent's todo/task list is mirrored to `todo.md` in the
  working directory as it changes.
- **Tools.** The agent reads, writes and edits files, searches with Grep/Glob
  (ripgrep), runs shell commands, fetches web pages, and can start sub-agents.
- **Self-correcting loop.** When the agent tries to stop after editing files,
  DopeCode runs the project's tests (`DOPE_TEST_CMD`, or a command detected from
  `package.json`, `Makefile`, pytest, cargo or go). On failure the output goes back
  to the model to fix. This repeats at most `DOPE_VERIFY_MAX_ITERATIONS` times, so
  an unfixable failure stops instead of burning your key.
- **Context management.** Long conversations are summarised automatically so the
  model's context window never overflows.

## Web command center

Inside the TUI, type **`/web`**. It starts the local agent API on
`127.0.0.1:4096` (the protocol in `harness-web/PROTOCOL.md`) and, if the UI is
installed, the harness-web app on `http://127.0.0.1:3000`. Install the UI once
(needs Node.js and npm):

```bash
cd harness-web && npm install
```

In the web UI you can pick a folder, open tabs (sessions), and chat with the agent
while it streams text and tool calls. Under **Keys** you can add a DeepSeek or Qwen
key, or a base URL for any OpenAI-compatible server.

Keys added in the UI are stored in `~/.dope/providers.json` (mode 0600), outside
the repository. The agent never returns a stored key (only a masked hint) and never
logs request bodies. It only listens on loopback, and it rejects requests that
carry a foreign `Host` or any `Origin`. Web sessions run with file edits and shell
commands allowed inside the chosen folder, because the UI has no permission prompts.
The TUI also uses the provider and model last picked in the web UI, unless
`AI_API_KEY` is set.

## Testing

```bash
make test
```

This runs the unit tests (the OpenAI-compatible adapter and provider/key
resolution) and then checks that the built CLI starts. The tests need neither a
key nor network access.

## Project layout

```
Makefile                      setup / run / test / clean / install
src/entrypoints/cli.tsx       CLI entry point
src/main.tsx                  command-line parsing and TUI launch
src/screens/REPL.tsx          the interactive TUI
src/query.ts, src/query/      agent loop, stop hooks, self-correcting test loop
src/services/api/             OpenAI-compatible adapter + provider/model config
src/tools/                    tools the agent can call (files, Grep, Bash, ...)
src/commands/                 slash commands
src/server/agent/             local agent API used by the web command center
harness-web/                  web command center (Next.js)
scripts/build-bundle.ts       build script (bun + esbuild) -> dist/cli.mjs
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `bun: command not found` after `make setup` | Setup installed bun to `~/.bun/bin`. The Makefile finds it automatically; to use bun directly, open a new terminal. |
| `ripgrep` warning during setup | Install it manually: `brew install ripgrep` or `sudo apt-get install ripgrep`. |
| `No model provider configured` | `AI_API_KEY` is not exported in this shell. |
| Error saying every endpoint rejected the key | The key is not a valid DeepSeek, Qwen or OpenRouter key. For other providers, set `AI_PROVIDER` or `AI_BASE_URL`. |
| `Input must be provided ... when using --print` | `make run` needs an interactive terminal. It switches to one-shot mode when stdin is not a TTY. |

## Development

```bash
bun run build        # rebuild dist/cli.mjs
bun test             # unit tests
bun run typecheck    # the inherited tree is not tsc-clean; the build is the gate
```
