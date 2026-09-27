// Typed client for the agent, via this app's /api/agent proxy.

import type {
  AgentEvent,
  DirListing,
  ModelRef,
  Project,
  Provider,
  SendMessageResult,
  ServerInfo,
  Session,
  SessionDetail,
  SetProviderBody,
} from "./protocol";

const BASE = "/api/agent";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach the web app server.", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  info: () => request<ServerInfo>("GET", "/health"),
  listDir: (path?: string, hidden = false) =>
    request<DirListing>("GET", `/fs/list?${new URLSearchParams({ ...(path ? { path } : {}), ...(hidden ? { hidden: "1" } : {}) })}`),

  projects: () => request<Project[]>("GET", "/projects"),
  openProject: (path: string) => request<Project>("POST", "/projects", { path }),
  removeProject: (id: string) => request<void>("DELETE", `/projects/${enc(id)}`),

  sessions: (projectId: string) => request<Session[]>("GET", `/projects/${enc(projectId)}/sessions`),
  createSession: (projectId: string) => request<Session>("POST", `/projects/${enc(projectId)}/sessions`, {}),
  session: (id: string) => request<SessionDetail>("GET", `/sessions/${enc(id)}`),
  renameSession: (id: string, title: string) => request<Session>("PATCH", `/sessions/${enc(id)}`, { title }),
  deleteSession: (id: string) => request<void>("DELETE", `/sessions/${enc(id)}`),
  send: (id: string, text: string, model: ModelRef) =>
    request<SendMessageResult>("POST", `/sessions/${enc(id)}/messages`, { text, model }),
  abort: (id: string) => request<void>("POST", `/sessions/${enc(id)}/abort`),

  providers: () => request<Provider[]>("GET", "/providers"),
  setProvider: (id: string, body: SetProviderBody) => request<Provider>("PUT", `/providers/${enc(id)}`, body),
  clearProvider: (id: string) => request<Provider>("DELETE", `/providers/${enc(id)}`),
};

/**
 * One EventSource for every tab: browsers cap connections per origin, so a
 * stream per session would stall after a handful of tabs. Reconnects with
 * backoff when the agent or the proxy goes away.
 */
export function connectEvents(onEvent: (event: AgentEvent) => void, onDown: () => void) {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  let stopped = false;

  const open = () => {
    source = new EventSource(`${BASE}/events`);
    source.onmessage = (e) => {
      delay = 1000;
      let event: AgentEvent;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      onEvent(event);
    };
    source.onerror = () => {
      onDown();
      // The browser retries a dropped stream by itself, but gives up for good
      // when the proxy answers with an error (agent not running). Retry then.
      if (source?.readyState === EventSource.CLOSED && !stopped) {
        source.close();
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 10_000);
      }
    };
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}
