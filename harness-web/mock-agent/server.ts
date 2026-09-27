// Mock agent server: implements the DopeCode Agent Protocol (PROTOCOL.md) with
// canned turns so the web UI can be built and tested before the real agent
// exists. Listens on 127.0.0.1 only.
//
//   npm run dev:agent            (auto-restarts on change)
//   DOPECODE_AGENT_PORT=4096      port to listen on
//   DOPECODE_AGENT_TOKEN=...      optional bearer token the web app must send
//   DOPECODE_DATA_DIR=~/.dopecode-mock   where state.json and auth.json live

import "./env";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename } from "node:path";
import {
  PROTOCOL_VERSION,
  type CreateProjectBody,
  type CreateSessionBody,
  type Project,
  type SendMessageBody,
  type ServerInfo,
  type Session,
  type SetProviderBody,
  type UpdateSessionBody,
} from "../lib/protocol";
import { FsError, assertDir, gitInfo, listDir, resolveUserPath } from "./fsutil";
import { InputError, KEY_STORAGE_NOTE, clearProvider, getProvider, listProviders, loadAuth, setProvider } from "./providers";
import {
  DATA_DIR,
  addClient,
  emit,
  ensureDataDir,
  loadState,
  messages,
  newId,
  projects,
  saveNow,
  scheduleSave,
  sendTo,
  sessions,
  touchSession,
} from "./store";
import { abortTurn, isRunning, startTurn } from "./turn";

const PORT = Number(process.env.DOPECODE_AGENT_PORT ?? 4096);
const HOST = "127.0.0.1";
const TOKEN = process.env.DOPECODE_AGENT_TOKEN || null;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}

const STREAMING = Symbol("streaming");

function info(): ServerInfo {
  return {
    name: "dopecode-mock-agent",
    version: "0.1.0",
    protocol: PROTOCOL_VERSION,
    mock: true,
    home: homedir(),
    keyStorage: KEY_STORAGE_NOTE,
  };
}

// ---- Request plumbing -------------------------------------------------------

function tokenMatches(header: string | undefined) {
  if (!TOKEN) return true;
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Rejects anything that isn't the local web app talking server-to-server. */
function guard(req: IncomingMessage): string | null {
  const host = (req.headers.host ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  // A foreign Host header means DNS rebinding; an Origin header means a web page called us directly.
  if (!LOOPBACK_HOSTS.has(hostname)) return "Host not allowed.";
  if (req.headers.origin) return "Call the agent through the web app, not from a browser page.";
  if (!tokenMatches(req.headers.authorization)) return "Missing or wrong agent token.";
  return null;
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new HttpError(415, "Send a JSON body (content-type: application/json).");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
  } catch {
    throw new HttpError(400, "Request body isn't valid JSON.");
  }
}

function sendJson(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

// ---- Handlers -----------------------------------------------------------------

function mustProject(id: string) {
  const project = projects.get(id);
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}

function mustSession(id: string) {
  const session = sessions.get(id);
  if (!session) throw new HttpError(404, "Session not found.");
  return session;
}

async function refreshGit(project: Project) {
  const git = await gitInfo(project.path);
  if (JSON.stringify(git) === JSON.stringify(project.git)) return project;
  const next = { ...project, git };
  projects.set(next.id, next);
  scheduleSave();
  return next;
}

async function openProject(body: CreateProjectBody) {
  const path = resolveUserPath(body.path);
  await assertDir(path);
  const existing = [...projects.values()].find((p) => p.path === path);
  const project: Project = {
    id: existing?.id ?? newId("prj"),
    path,
    name: basename(path) || path,
    git: await gitInfo(path),
    lastOpenedAt: Date.now(),
  };
  projects.set(project.id, project);
  emit({ type: "project.updated", project });
  scheduleSave();
  return new Reply(existing ? 200 : 201, project);
}

function deleteSessionById(id: string) {
  abortTurn(id);
  sessions.delete(id);
  messages.delete(id);
  emit({ type: "session.deleted", sessionId: id });
}

function createSession(projectId: string, body: CreateSessionBody) {
  const project = mustProject(projectId);
  const now = Date.now();
  const session: Session = {
    id: newId("ses"),
    projectId,
    title: body.title?.trim().slice(0, 120) || null,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.id, session);
  messages.set(session.id, []);
  const touched = { ...project, lastOpenedAt: now };
  projects.set(project.id, touched);
  emit({ type: "session.updated", session });
  emit({ type: "project.updated", project: touched });
  scheduleSave();
  return new Reply(201, session);
}

function sendMessage(sessionId: string, body: SendMessageBody) {
  const session = mustSession(sessionId);
  const project = mustProject(session.projectId);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new HttpError(400, "Message is empty.");
  if (text.length > 100_000) throw new HttpError(413, "Message is too long.");
  if (isRunning(session.id)) throw new HttpError(409, "This session is still working. Stop it first.");

  const provider = body.model?.providerId ? getProvider(body.model.providerId) : null;
  if (!provider) throw new HttpError(400, "Pick a model first.");
  if (!provider.configured) throw new HttpError(400, `Add your ${provider.name} key first (Keys, top right).`);
  if (!provider.models.some((m) => m.id === body.model.modelId)) {
    throw new HttpError(400, `${provider.name} has no model called ${body.model.modelId}.`);
  }
  const model = { providerId: provider.id, modelId: body.model.modelId };
  return new Reply(202, startTurn({ session, project, provider, model, text }));
}

function openStream(res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 2000\n\n");
  addClient(res);
  sendTo(res, { type: "server.connected", info: info() });
  return STREAMING;
}

// ---- Routes ---------------------------------------------------------------------

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
}

type Handler = (ctx: Ctx) => unknown;

const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/health$/, () => info()],
  ["GET", /^\/events$/, ({ res }) => openStream(res)],

  ["GET", /^\/fs\/list$/, ({ url }) =>
    listDir(resolveUserPath(url.searchParams.get("path")), url.searchParams.get("hidden") === "1")],

  ["GET", /^\/projects$/, async () => {
    const list = await Promise.all([...projects.values()].map(refreshGit));
    return list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }],
  ["POST", /^\/projects$/, async ({ req }) => openProject(await readJson<CreateProjectBody>(req))],
  ["DELETE", /^\/projects\/([^/]+)$/, ({ params: [id] }) => {
    mustProject(id);
    for (const s of [...sessions.values()]) if (s.projectId === id) deleteSessionById(s.id);
    projects.delete(id);
    emit({ type: "project.deleted", projectId: id });
    scheduleSave();
    return new Reply(204);
  }],

  ["GET", /^\/projects\/([^/]+)\/sessions$/, ({ params: [id] }) => {
    mustProject(id);
    return [...sessions.values()].filter((s) => s.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt);
  }],
  ["POST", /^\/projects\/([^/]+)\/sessions$/, async ({ req, params: [id] }) =>
    createSession(id, await readJson<CreateSessionBody>(req))],

  ["GET", /^\/sessions\/([^/]+)$/, ({ params: [id] }) => ({
    session: mustSession(id),
    messages: messages.get(id) ?? [],
  })],
  ["PATCH", /^\/sessions\/([^/]+)$/, async ({ req, params: [id] }) => {
    const session = mustSession(id);
    const { title } = await readJson<UpdateSessionBody>(req);
    const clean = typeof title === "string" ? title.trim().slice(0, 120) : "";
    if (!clean) throw new HttpError(400, "Title can't be empty.");
    return touchSession(session, { title: clean });
  }],
  ["DELETE", /^\/sessions\/([^/]+)$/, ({ params: [id] }) => {
    mustSession(id);
    deleteSessionById(id);
    scheduleSave();
    return new Reply(204);
  }],
  ["POST", /^\/sessions\/([^/]+)\/messages$/, async ({ req, params: [id] }) =>
    sendMessage(id, await readJson<SendMessageBody>(req))],
  ["POST", /^\/sessions\/([^/]+)\/abort$/, ({ params: [id] }) => {
    mustSession(id);
    abortTurn(id);
    return new Reply(204);
  }],

  ["GET", /^\/providers$/, () => listProviders()],
  ["PUT", /^\/providers\/([^/]+)$/, async ({ req, params: [id] }) => {
    const provider = setProvider(id, await readJson<SetProviderBody>(req));
    emit({ type: "provider.updated", provider });
    return provider;
  }],
  ["DELETE", /^\/providers\/([^/]+)$/, ({ params: [id] }) => {
    const provider = clearProvider(id);
    emit({ type: "provider.updated", provider });
    return provider;
  }],
];

async function handle(req: IncomingMessage, res: ServerResponse) {
  const rejected = guard(req);
  if (rejected) return sendJson(res, 403, { error: rejected });

  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const method = req.method ?? "GET";
  const matches = routes.filter(([, pattern]) => pattern.test(url.pathname));
  if (!matches.length) return sendJson(res, 404, { error: `No route for ${url.pathname}` });
  const route = matches.find(([m]) => m === method);
  if (!route) return sendJson(res, 405, { error: `${method} isn't supported on ${url.pathname}` });

  const [, pattern, handler] = route;
  const params = (url.pathname.match(pattern) ?? []).slice(1).map(decodeURIComponent);
  const result = await handler({ req, res, url, params });
  if (result === STREAMING) return;
  if (result instanceof Reply) return sendJson(res, result.status, result.body);
  return sendJson(res, result === undefined ? 204 : 200, result);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError || err instanceof FsError) return sendJson(res, err.status, { error: err.message });
    if (err instanceof InputError) return sendJson(res, 400, { error: err.message });
    console.error(`[agent] ${req.method} ${req.url} failed:`, err);
    sendJson(res, 500, { error: "The agent hit an internal error." });
  });
});

ensureDataDir();
loadState();
loadAuth();

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[agent] Port ${PORT} is already in use. Set DOPECODE_AGENT_PORT to use another one.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`[agent] mock agent listening on http://${HOST}:${PORT}`);
  console.log(`[agent] data: ${DATA_DIR}${TOKEN ? " · token required" : ""}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    saveNow();
    process.exit(0);
  });
}
