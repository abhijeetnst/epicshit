# DopeCode Agent Protocol (v1)

This is the contract between the web UI and the local agent. DopeCode serves
it for real (`../src/server/agent/server.ts`, started by `/web` in the TUI or
`dope agent`); the mock agent in `mock-agent/` implements the same endpoints with
canned turns. The UI doesn't change between them.

The JSON shapes are defined in [`lib/protocol.ts`](lib/protocol.ts), which is the
source of truth. This page covers behavior.

```
browser ──► Next.js  /api/agent/*  ──► agent  (DOPECODE_AGENT_URL, default http://127.0.0.1:4096)
   ▲          same-origin proxy           │
   └──────── one SSE stream ◄─────────────┘  GET /events
```

The browser never talks to the agent directly. It calls `/api/agent/<path>`
on the web app, which forwards the request to `<DOPECODE_AGENT_URL>/<path>`.
The proxy keeps the query string, the `content-type`/`accept` headers and the
body, and it adds `Authorization: Bearer <DOPECODE_AGENT_TOKEN>` when that
variable is set.

## Transport and security

The agent can hold API keys and, once it's real, run commands, so it must:

- **Listen on loopback only** (`127.0.0.1`).
- **Reject a non-loopback `Host` header** with 403. This blocks DNS rebinding.
- **Reject any request that carries an `Origin` header** with 403. The proxy
  never sends one, so its presence means a web page is calling the agent
  directly.
- **Check the bearer token** when `DOPECODE_AGENT_TOKEN` is set.
- **Never return a stored key.** Return only a masked hint such as `••••3f9a`.
- **Never log request bodies**, because they may contain keys.

All requests and responses are JSON (`content-type: application/json`) except
`/events`. Errors look like `{ "error": "Human-readable message" }`. The UI
shows that message as-is, so write it for a person.

| Status | Meaning |
| --- | --- |
| 200 / 201 | OK / created |
| 202 | Accepted; the result arrives on the event stream |
| 204 | OK, no body |
| 400 | Bad input (message says what) |
| 403 | Guard rejected the request |
| 404 | Unknown project, session or route |
| 409 | Session is busy |
| 413 / 415 | Body too large / not JSON |

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | | `ServerInfo` |
| GET | `/events` | | SSE stream of `AgentEvent` |
| GET | `/fs/list?path=&hidden=1` | | `DirListing` (folders only; `path` defaults to home, `~` allowed) |
| GET | `/projects` | | `Project[]`, most recently opened first |
| POST | `/projects` | `{ path }` | `Project` (201 new, 200 if the folder was already known) |
| DELETE | `/projects/:id` | | 204. Forgets the folder and its sessions; files on disk are untouched |
| GET | `/projects/:id/sessions` | | `Session[]`, most recently updated first |
| POST | `/projects/:id/sessions` | `{ title? }` | `Session` (201) |
| GET | `/sessions/:id` | | `SessionDetail` (`{ session, messages }`) |
| PATCH | `/sessions/:id` | `{ title }` | `Session` |
| DELETE | `/sessions/:id` | | 204 (stops a running turn first) |
| POST | `/sessions/:id/messages` | `{ text, model: { providerId, modelId } }` | 202 `{ userMessageId, assistantMessageId }` |
| POST | `/sessions/:id/abort` | | 204 (no-op when idle) |
| GET | `/providers` | | `Provider[]` |
| PUT | `/providers/:id` | `{ apiKey?, baseUrl?, models? }` | `Provider` |
| DELETE | `/providers/:id` | | `Provider` (now unconfigured) |

### Projects are folders

A project is an absolute folder path on the agent's machine. The folder picker
browses with `/fs/list`, then opens the chosen folder with `POST /projects`.
Opening the same path twice returns the same project. `git` is `null` outside a
repository; otherwise it holds the current branch (`null` for a detached HEAD).

### Sessions and tabs

Every UI tab is one session, and many sessions can share a folder. A tab starts
as a draft; the UI creates the session (`POST /projects/:id/sessions`) when the
first prompt is sent. Sessions in different tabs can run at the same time. A
second prompt to a busy session gets 409.

### Bring your own key

`PUT /providers/:id` sets any of `apiKey`, `baseUrl` and `models`. Omitted
fields keep their stored value, so the UI can edit models without asking for
the key again. An empty `baseUrl` clears it; an empty `models` list restores
the defaults. The agent decides what "configured" means (usually "has a key";
for OpenAI-compatible endpoints, "has a base URL") and reports it in
`Provider.configured`. `POST /sessions/:id/messages` must fail with 400 if the
chosen provider isn't configured or doesn't list the model.

## Event stream

`GET /events` is a single Server-Sent Events stream for everything. The UI opens
exactly one, whatever the number of tabs, because browsers cap connections per
origin. Each event is one `data:` line holding an `AgentEvent` JSON object with
a `type` field; no `event:` names are used. Send a comment line
(`: ping`) every ~15 s to keep proxies from closing idle streams.

- The first event on every connection is `server.connected` with `ServerInfo`.
  The UI then re-reads projects, providers and every open session, so the agent
  never has to replay missed events.
- `message.updated` carries a full message snapshot. Send it when a message is
  created and when it finishes (`done`, `error` or `aborted`).
- `part.updated` adds a part or replaces one by `id`, for example a tool going
  from `running` to `done`.
- `part.delta` appends `delta` to the `text` of an existing text part. Send
  `part.updated` for the part first.
- `session.updated` is sent whenever a session changes. In particular,
  `status` is `busy` while a turn runs and `idle` after it, and `title` is set
  once the agent names the session.
- `project.updated`, `project.deleted`, `session.deleted` and `provider.updated`
  do what their names say.

### One turn, in order

```
POST /sessions/s1/messages  → 202
  message.updated   user message (status done)
  message.updated   assistant message (status streaming, no parts)
  session.updated   status busy (and a title, on the first prompt)
  part.updated      text part, empty
  part.delta ×N     streamed text
  part.updated      tool part, running
  part.updated      same tool part, done, with output
  part.updated      another text part …
  part.delta ×N
  message.updated   assistant message, status done | error | aborted
  session.updated   status idle
```

## Checklist for a real agent

1. Serve the endpoints above on `127.0.0.1` with the guards from
   *Transport and security*.
2. Store keys somewhere only your user can read (the mock uses a `0600` file),
   and return only masked hints.
3. Map `providerId`/`modelId` to your model client. For `openai-compatible`,
   call `baseUrl` with the stored key if there is one.
4. Turn your agent loop's output into `part.*` events: model text becomes a
   text part, and each tool call becomes a tool part that goes `running` then
   `done`/`error`, with its output.
5. Honor `POST /sessions/:id/abort` promptly and finish with `status: "aborted"`.
6. Point the web app at it: `DOPECODE_AGENT_URL=http://127.0.0.1:<port>`.
