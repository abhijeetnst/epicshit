<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DopeCode (harness-web)

Web UI for the local coding agent, plus a mock agent that stands in for it.

- The UI talks to the agent only through the proxy in `app/api/agent/[...path]/route.ts`. Don't add direct browser-to-agent calls.
- `lib/protocol.ts` is the wire contract; keep `PROTOCOL.md`, `mock-agent/` and the real agent (`../src/server/agent/server.ts`, which imports these types) in step with it when it changes.
- API keys must never be written to browser storage, logged, or returned by the agent in full (masked `keyHint` only).
- `mock-agent/` is a stand-in: it must not call model providers or run commands. Its only filesystem access is folder listing, `.git/HEAD`, and the top-level listing for the mock `list` tool.
- `components/crabs/engine.ts` moves plain DOM nodes in a rAF loop; keep per-frame work out of React. The crab overlay is `pointer-events: none` and hit-tests input itself, so it must never block the UI.
- The crab sprite is an original pixel-art sprite; keep it or swap it in `sprites.ts`.
- Checks: `npm run typecheck`, `npm run lint`, `npm run build`.
