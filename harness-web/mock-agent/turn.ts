// A pretend agent turn: streams text, runs one read-only "list" tool on the
// project folder, and finishes. It exercises every event the UI handles
// without calling a model.

import type { Message, ModelRef, Project, Provider, SendMessageResult, Session, TextPart, ToolPart } from "../lib/protocol";
import { gitInfo, topLevel } from "./fsutil";
import { emit, messages, newId, scheduleSave, sessions, touchSession } from "./store";

const running = new Map<string, AbortController>();

export function isRunning(sessionId: string) {
  return running.has(sessionId);
}

export function abortTurn(sessionId: string) {
  running.get(sessionId)?.abort();
}

interface TurnInput {
  session: Session;
  project: Project;
  provider: Provider;
  model: ModelRef;
  text: string;
}

export function startTurn({ session, project, provider, model, text }: TurnInput): SendMessageResult {
  const list = messages.get(session.id) ?? [];
  messages.set(session.id, list);

  const user: Message = {
    id: newId("msg"),
    sessionId: session.id,
    role: "user",
    createdAt: Date.now(),
    status: "done",
    parts: [{ id: newId("prt"), type: "text", text }],
  };
  const assistant: Message = {
    id: newId("msg"),
    sessionId: session.id,
    role: "assistant",
    createdAt: Date.now(),
    model,
    status: "streaming",
    parts: [],
  };
  list.push(user, assistant);
  emit({ type: "message.updated", message: user });
  emit({ type: "message.updated", message: assistant });
  touchSession(session, { status: "busy", title: session.title ?? titleFrom(text) });

  const controller = new AbortController();
  running.set(session.id, controller);
  void run({ session, project, provider, model, text }, assistant, controller.signal);
  return { userMessageId: user.id, assistantMessageId: assistant.id };
}

async function run(input: TurnInput, assistant: Message, signal: AbortSignal) {
  const { project, provider, model, text } = input;
  try {
    await streamText(assistant, intro(provider, model, text), signal);

    const tool: ToolPart = {
      id: newId("prt"),
      type: "tool",
      tool: "list",
      title: project.path,
      input: { path: project.path },
      status: "running",
    };
    addPart(assistant, tool);
    await sleep(500, signal);
    const [listing, git] = await Promise.all([topLevel(project.path), gitInfo(project.path)]);
    tool.status = "done";
    tool.output =
      listing.shown.join("\n") + (listing.total > listing.shown.length ? `\n… ${listing.total - listing.shown.length} more` : "");
    emitPart(assistant, tool);

    await streamText(assistant, outro(project, listing.total, git?.branch ?? (git ? "a detached HEAD" : null)), signal);
    assistant.status = "done";
  } catch (err) {
    if (signal.aborted) {
      assistant.status = "aborted";
    } else {
      assistant.status = "error";
      assistant.error = err instanceof Error ? err.message : String(err);
    }
    for (const part of assistant.parts) {
      if (part.type === "tool" && part.status === "running") {
        part.status = "error";
        part.output = signal.aborted ? "Stopped" : "Failed";
      }
    }
  } finally {
    running.delete(input.session.id);
    emit({ type: "message.updated", message: assistant });
    const latest = sessions.get(input.session.id);
    if (latest) touchSession(latest, { status: "idle" });
    scheduleSave();
  }
}

function intro(provider: Provider, model: ModelRef, text: string) {
  const keyLine = provider.keyHint
    ? `using the key it holds for ${provider.name} (${provider.keyHint})`
    : `with no key, since ${provider.baseUrl ?? "that endpoint"} doesn't need one`;
  const quoted = text
    .slice(0, 280)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return [
    "**Mock agent.** No model was called, and nothing left this machine.",
    "",
    `A real agent would now send your prompt to \`${model.providerId}/${model.modelId}\` ${keyLine}. You asked:`,
    "",
    quoted + (text.length > 280 ? "…" : ""),
    "",
    "First, a look at the folder.",
  ].join("\n");
}

function outro(project: Project, total: number, branch: string | null) {
  const where = branch ? `, and it's a git repo on \`${branch}\`` : ", and it isn't a git repo";
  return [
    `\`${project.name}\` has ${total} top-level entries${where}.`,
    "",
    "To plug in your real agent, serve the same endpoints (see `PROTOCOL.md`) and point `DOPECODE_AGENT_URL` at it. The web UI doesn't need to change.",
  ].join("\n");
}

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ");
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || "Untitled";
}

function addPart(message: Message, part: TextPart | ToolPart) {
  message.parts.push(part);
  emitPart(message, part);
}

function emitPart(message: Message, part: TextPart | ToolPart) {
  emit({ type: "part.updated", sessionId: message.sessionId, messageId: message.id, part });
}

async function streamText(message: Message, text: string, signal: AbortSignal) {
  const part: TextPart = { id: newId("prt"), type: "text", text: "" };
  addPart(message, part);
  // Emit a few words at a time, the way a model streams tokens.
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  for (let i = 0; i < tokens.length; ) {
    const n = 1 + Math.floor(Math.random() * 3);
    const delta = tokens.slice(i, i + n).join("");
    i += n;
    await sleep(18 + Math.random() * 40, signal);
    part.text += delta;
    emit({ type: "part.delta", sessionId: message.sessionId, messageId: message.id, partId: part.id, delta });
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
