// In-memory state for the mock agent, saved to $DOPECODE_DATA_DIR/state.json
// so projects and sessions survive a restart. API keys live separately in
// providers.ts (auth.json).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerResponse } from "node:http";
import type { AgentEvent, Message, Project, Session } from "../lib/protocol";

// "~" isn't expanded when the value comes from an env file, so do it here.
export const DATA_DIR = process.env.DOPECODE_DATA_DIR
  ? resolve(process.env.DOPECODE_DATA_DIR.replace(/^~(?=$|\/)/, homedir()))
  : join(homedir(), ".dopecode-mock");
const STATE_FILE = join(DATA_DIR, "state.json");

interface Snapshot {
  projects: Project[];
  sessions: Session[];
  messages: Record<string, Message[]>;
}

export const projects = new Map<string, Project>();
export const sessions = new Map<string, Session>();
export const messages = new Map<string, Message[]>();

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

export function loadState() {
  let snap: Snapshot;
  try {
    snap = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Snapshot;
  } catch {
    return;
  }
  for (const p of snap.projects ?? []) projects.set(p.id, p);
  for (const s of snap.sessions ?? []) {
    // A turn can't survive a restart, so nothing is busy after one.
    sessions.set(s.id, { ...s, status: "idle" });
  }
  for (const [sessionId, list] of Object.entries(snap.messages ?? {})) {
    messages.set(
      sessionId,
      list.map((m) =>
        m.status === "streaming"
          ? {
              ...m,
              status: "aborted",
              parts: m.parts.map((p) =>
                p.type === "tool" && p.status === "running" ? { ...p, status: "error", output: "Interrupted" } : p,
              ),
            }
          : m,
      ),
    );
  }
}

let saveTimer: NodeJS.Timeout | null = null;

export function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 300);
}

export function saveNow() {
  const snap: Snapshot = {
    projects: [...projects.values()],
    sessions: [...sessions.values()],
    messages: Object.fromEntries(messages),
  };
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 });
  renameSync(tmp, STATE_FILE);
}

// ---- Event bus ------------------------------------------------------------

const clients = new Set<ServerResponse>();

export function addClient(res: ServerResponse) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function emit(event: AgentEvent) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(frame);
}

export function sendTo(res: ServerResponse, event: AgentEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

setInterval(() => {
  for (const res of clients) res.write(": ping\n\n");
}, 15_000).unref();

// ---- Helpers --------------------------------------------------------------

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function touchSession(session: Session, patch: Partial<Session> = {}) {
  const next = { ...session, ...patch, updatedAt: Date.now() };
  sessions.set(next.id, next);
  emit({ type: "session.updated", session: next });
  scheduleSave();
  return next;
}
