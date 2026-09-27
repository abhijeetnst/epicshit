// Client state. The agent owns projects, sessions, messages and keys; this
// store mirrors them from the event stream. Only the tab layout, the chosen
// model and display preferences are kept in localStorage — never API keys.

import { create } from "zustand";
import { ApiError, api, connectEvents } from "./api";
import type { AgentEvent, Message, ModelRef, Part, Project, Provider, ServerInfo, Session, SetProviderBody } from "./protocol";

export interface Tab {
  id: string;
  projectId: string | null;
  /** Null for a draft: the session is created when the first prompt is sent. */
  sessionId: string | null;
}

export type Connection = "connecting" | "online" | "offline";

export type Dialog =
  | null
  | { kind: "folder"; target: "active" | "new" }
  | { kind: "providers"; focus?: string }
  | { kind: "sessions" };

export type CrabSize = "small" | "medium" | "large";

/** Screen pixels per sprite pixel for each crab size. */
export const CRAB_CELLS: Record<CrabSize, number> = { small: 2, medium: 3, large: 4 };

export interface Toast {
  id: string;
  text: string;
}

interface State {
  ready: boolean;
  connection: Connection;
  connectionError: string | null;
  info: ServerInfo | null;
  projects: Record<string, Project>;
  sessions: Record<string, Session>;
  /** Present only for sessions whose history has been loaded. */
  messages: Record<string, Message[]>;
  providers: Provider[];
  providersLoaded: boolean;
  tabs: Tab[];
  activeTabId: string | null;
  model: ModelRef | null;
  /** One pixel crab per tab, acting out its session. */
  crabs: boolean;
  crabSize: CrabSize;
  /** Chime when a session in a background tab finishes. */
  chime: boolean;
  dialog: Dialog;
  toasts: Toast[];
}

export const useApp = create<State>(() => ({
  ready: false,
  connection: "connecting",
  connectionError: null,
  info: null,
  projects: {},
  sessions: {},
  messages: {},
  providers: [],
  providersLoaded: false,
  tabs: [],
  activeTabId: null,
  model: null,
  crabs: true,
  crabSize: "medium",
  chime: false,
  dialog: null,
  toasts: [],
}));

const { getState: get, setState: set } = useApp;

// ---- Local persistence (tab layout only) -----------------------------------------

const STORAGE_KEY = "dopecode:v1";
const LEGACY_STORAGE_KEY = "harness-web:v1";

interface Saved {
  tabs?: Tab[];
  activeTabId?: string | null;
  model?: ModelRef | null;
  crabs?: boolean;
  crabSize?: CrabSize;
  chime?: boolean;
  /** Older builds stored a crew size; "off" meant no mascots. */
  crew?: string;
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return JSON.parse(raw ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function save(state: State) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        model: state.model,
        crabs: state.crabs,
        crabSize: state.crabSize,
        chime: state.chime,
      } satisfies Saved),
    );
  } catch {
    // Storage can be unavailable (private mode, blocked site data). Tabs just won't persist.
  }
}

function newTabId() {
  return crypto.randomUUID();
}

// ---- Derived helpers ------------------------------------------------------------------

export function recentProjects(projects: Record<string, Project>) {
  return Object.values(projects).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function availableModels(providers: Provider[]) {
  return providers.filter((p) => p.configured).flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));
}

function modelAvailable(model: ModelRef | null, providers: Provider[]) {
  return (
    !!model && availableModels(providers).some((a) => a.provider.id === model.providerId && a.model.id === model.modelId)
  );
}

// ---- Startup and event stream ---------------------------------------------------

/** Restores tabs, opens the event stream, and returns a cleanup function. */
export function start() {
  const saved = loadSaved();
  const tabs = (Array.isArray(saved.tabs) ? saved.tabs : []).filter(
    (t): t is Tab => typeof t?.id === "string" && (t.sessionId === null || typeof t.sessionId === "string"),
  );
  if (!tabs.length) tabs.push({ id: newTabId(), projectId: null, sessionId: null });
  const activeTabId = tabs.some((t) => t.id === saved.activeTabId) ? saved.activeTabId! : tabs[0].id;
  // Crabs stay off for people who asked for less motion, until they turn them on.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const crabs = typeof saved.crabs === "boolean" ? saved.crabs : saved.crew ? saved.crew !== "off" : !reduceMotion;
  const crabSize = saved.crabSize && saved.crabSize in CRAB_CELLS ? saved.crabSize : "medium";
  set({ ready: true, tabs, activeTabId, model: saved.model ?? null, crabs, crabSize, chime: saved.chime === true });

  const unsubscribe = useApp.subscribe((s, prev) => {
    if (
      s.tabs !== prev.tabs ||
      s.activeTabId !== prev.activeTabId ||
      s.model !== prev.model ||
      s.crabs !== prev.crabs ||
      s.crabSize !== prev.crabSize ||
      s.chime !== prev.chime
    ) {
      save(s);
    }
  });
  const stop = connectEvents(handleEvent, () => {
    if (get().connection === "offline") return;
    set({ connection: "offline" });
    api.info().catch((e: Error) => set({ connectionError: e.message }));
  });
  return () => {
    stop();
    unsubscribe();
  };
}

function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case "server.connected":
      set({ connection: "online", connectionError: null, info: event.info });
      void resync();
      return;
    case "project.updated":
      set((s) => ({ projects: { ...s.projects, [event.project.id]: event.project } }));
      return;
    case "project.deleted":
      dropProject(event.projectId);
      return;
    case "session.updated":
      set((s) => ({ sessions: { ...s.sessions, [event.session.id]: event.session } }));
      return;
    case "session.deleted":
      dropSession(event.sessionId);
      return;
    case "message.updated":
      updateMessages(event.message.sessionId, (list) => upsertBy(list, event.message));
      return;
    case "part.updated":
      updateMessage(event.sessionId, event.messageId, (m) => ({ ...m, parts: upsertBy(m.parts, event.part) }));
      return;
    case "part.delta":
      updateMessage(event.sessionId, event.messageId, (m) => ({
        ...m,
        parts: m.parts.map((p): Part => (p.id === event.partId && p.type === "text" ? { ...p, text: p.text + event.delta } : p)),
      }));
      return;
    case "provider.updated":
      set((s) => ({ providers: upsertBy(s.providers, event.provider) }));
      ensureModel();
      return;
  }
}

function upsertBy<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function updateMessages(sessionId: string, fn: (list: Message[]) => Message[]) {
  set((s) => {
    const list = s.messages[sessionId];
    // Sessions nobody has opened are fetched in full when a tab shows them.
    if (!list) return s;
    return { messages: { ...s.messages, [sessionId]: fn(list) } };
  });
}

function updateMessage(sessionId: string, messageId: string, fn: (m: Message) => Message) {
  updateMessages(sessionId, (list) => list.map((m) => (m.id === messageId ? fn(m) : m)));
}

/** Re-reads everything the UI shows. Runs on every (re)connect, so missed events don't linger. */
async function resync() {
  let projects: Project[];
  let providers: Provider[];
  try {
    [projects, providers] = await Promise.all([api.projects(), api.providers()]);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  const sessionIds = [...new Set(get().tabs.map((t) => t.sessionId).filter((id): id is string => !!id))];
  const details = await Promise.all(
    sessionIds.map((id) =>
      api.session(id).then(
        (d) => d,
        (e) => (e instanceof ApiError && e.status === 404 ? null : undefined),
      ),
    ),
  );

  set((s) => {
    const sessions = { ...s.sessions };
    const messages = { ...s.messages };
    const gone = new Set<string>();
    details.forEach((d, i) => {
      if (d === null) gone.add(sessionIds[i]);
      else if (d) {
        sessions[d.session.id] = d.session;
        messages[d.session.id] = d.messages;
      }
    });
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const fallback = projects[0]?.id ?? null;
    let tabs = s.tabs
      .filter((t) => !t.sessionId || !gone.has(t.sessionId))
      .map((t) => {
        if (t.sessionId) return { ...t, projectId: sessions[t.sessionId]?.projectId ?? t.projectId };
        return { ...t, projectId: t.projectId && byId[t.projectId] ? t.projectId : fallback };
      });
    if (!tabs.length) tabs = [{ id: newTabId(), projectId: fallback, sessionId: null }];
    const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0].id;
    return { projects: byId, providers, providersLoaded: true, sessions, messages, tabs, activeTabId };
  });
  ensureModel();
}

function ensureModel() {
  const { model, providers, providersLoaded } = get();
  if (!providersLoaded || modelAvailable(model, providers)) return;
  const first = availableModels(providers)[0];
  set({ model: first ? { providerId: first.provider.id, modelId: first.model.id } : null });
}

function closeTabsWhere(pred: (t: Tab) => boolean) {
  set((s) => {
    const activeIndex = s.tabs.findIndex((t) => t.id === s.activeTabId);
    let tabs = s.tabs.filter((t) => !pred(t));
    if (tabs.length === s.tabs.length) return s;
    const fallback = recentProjects(s.projects)[0]?.id ?? null;
    if (!tabs.length) tabs = [{ id: newTabId(), projectId: fallback, sessionId: null }];
    const activeTabId = tabs.some((t) => t.id === s.activeTabId)
      ? s.activeTabId
      : tabs[Math.min(Math.max(activeIndex, 0), tabs.length - 1)].id;
    return { tabs, activeTabId };
  });
}

function dropSession(sessionId: string) {
  set((s) => {
    const sessions = { ...s.sessions };
    const messages = { ...s.messages };
    delete sessions[sessionId];
    delete messages[sessionId];
    return { sessions, messages };
  });
  closeTabsWhere((t) => t.sessionId === sessionId);
}

function dropProject(projectId: string) {
  set((s) => {
    const projects = { ...s.projects };
    delete projects[projectId];
    return { projects };
  });
  closeTabsWhere((t) => t.projectId === projectId);
}

// ---- Actions --------------------------------------------------------------------

export function toast(text: string) {
  const id = crypto.randomUUID();
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
}

export function dismissToast(id: string) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function openDialog(dialog: Dialog) {
  set({ dialog });
}

export function closeDialog() {
  set({ dialog: null });
}

export function activateTab(id: string) {
  set({ activeTabId: id });
}

export function newTab(projectId?: string | null) {
  set((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    const tab: Tab = {
      id: newTabId(),
      projectId: projectId !== undefined ? projectId : (active?.projectId ?? recentProjects(s.projects)[0]?.id ?? null),
      sessionId: null,
    };
    const at = active ? s.tabs.indexOf(active) + 1 : s.tabs.length;
    return { tabs: [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)], activeTabId: tab.id };
  });
}

export function closeTab(id: string) {
  const tab = get().tabs.find((t) => t.id === id);
  if (!tab) return;
  if (get().tabs.length === 1) {
    // Closing the last tab leaves a fresh draft in the same folder.
    const fresh: Tab = { id: newTabId(), projectId: tab.projectId, sessionId: null };
    set({ tabs: [fresh], activeTabId: fresh.id });
    return;
  }
  closeTabsWhere((t) => t.id === id);
}

export function moveTab(id: string, delta: number) {
  set((s) => {
    const i = s.tabs.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= s.tabs.length) return s;
    const tabs = s.tabs.slice();
    [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
    return { tabs };
  });
}

export function setTabProject(tabId: string, projectId: string) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId && !t.sessionId ? { ...t, projectId } : t)) }));
}

export async function loadSession(sessionId: string) {
  try {
    const detail = await api.session(sessionId);
    set((s) => ({
      sessions: { ...s.sessions, [sessionId]: detail.session },
      messages: { ...s.messages, [sessionId]: detail.messages },
    }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) dropSession(sessionId);
    else toast((e as Error).message);
  }
}

export function openSession(sessionId: string) {
  const s = get();
  const existing = s.tabs.find((t) => t.sessionId === sessionId);
  if (existing) {
    set({ activeTabId: existing.id, dialog: null });
    return;
  }
  const projectId = s.sessions[sessionId]?.projectId ?? null;
  const active = s.tabs.find((t) => t.id === s.activeTabId);
  if (active && !active.sessionId) {
    // Reuse an untouched draft tab instead of piling up empty ones.
    set({ tabs: s.tabs.map((t) => (t.id === active.id ? { ...t, projectId, sessionId } : t)), dialog: null });
  } else {
    newTab(projectId);
    const id = get().activeTabId;
    set((st) => ({ tabs: st.tabs.map((t) => (t.id === id ? { ...t, sessionId } : t)), dialog: null }));
  }
  if (!s.messages[sessionId]) void loadSession(sessionId);
}

export async function openFolder(path: string, target: "active" | "new") {
  const project = await api.openProject(path);
  set((s) => ({ projects: { ...s.projects, [project.id]: project }, dialog: null }));
  const active = get().tabs.find((t) => t.id === get().activeTabId);
  if (target === "active" && active && !active.sessionId) setTabProject(active.id, project.id);
  else newTab(project.id);
  return project;
}

export async function fetchSessions(projectId: string) {
  const list = await api.sessions(projectId);
  set((s) => ({ sessions: { ...s.sessions, ...Object.fromEntries(list.map((x) => [x.id, x])) } }));
}

export function setModel(model: ModelRef) {
  set({ model });
}

export function setCrabs(crabs: boolean) {
  set({ crabs });
}

export function setCrabSize(crabSize: CrabSize) {
  set({ crabSize });
}

export function setChime(chime: boolean) {
  set({ chime });
}

export async function send(tabId: string, text: string): Promise<boolean> {
  const { tabs, model, providers } = get();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return false;
  if (!tab.projectId) {
    openDialog({ kind: "folder", target: "active" });
    return false;
  }
  if (!modelAvailable(model, providers)) {
    toast("Add an API key and pick a model first.");
    openDialog({ kind: "providers" });
    return false;
  }
  try {
    let sessionId = tab.sessionId;
    if (!sessionId) {
      const session = await api.createSession(tab.projectId);
      sessionId = session.id;
      set((s) => ({
        sessions: { ...s.sessions, [session.id]: s.sessions[session.id] ?? session },
        messages: { ...s.messages, [session.id]: s.messages[session.id] ?? [] },
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, sessionId: session.id } : t)),
      }));
    }
    await api.send(sessionId, text, model!);
    return true;
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
}

export async function abort(sessionId: string) {
  try {
    await api.abort(sessionId);
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function renameSession(sessionId: string, title: string) {
  try {
    const session = await api.renameSession(sessionId, title);
    set((s) => ({ sessions: { ...s.sessions, [session.id]: session } }));
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function deleteSession(sessionId: string) {
  try {
    await api.deleteSession(sessionId);
    dropSession(sessionId);
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function removeProject(projectId: string) {
  try {
    await api.removeProject(projectId);
    dropProject(projectId);
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function saveProvider(id: string, body: SetProviderBody) {
  const provider = await api.setProvider(id, body);
  set((s) => ({ providers: upsertBy(s.providers, provider) }));
  ensureModel();
  return provider;
}

export async function clearProvider(id: string) {
  const provider = await api.clearProvider(id);
  set((s) => ({ providers: upsertBy(s.providers, provider) }));
  ensureModel();
  return provider;
}
