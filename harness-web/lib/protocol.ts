// Wire types for the DopeCode Agent Protocol. PROTOCOL.md describes the
// endpoints; this file is the source of truth for the JSON shapes. The web UI
// and the mock agent both import it, and a real agent must emit the same shapes.

export const PROTOCOL_VERSION = 1;

export interface ServerInfo {
  name: string;
  version: string;
  protocol: number;
  mock: boolean;
  home: string;
  /** Human-readable note on where the agent keeps API keys, shown in the UI. */
  keyStorage: string;
}

// ---- Filesystem (folder picker) ------------------------------------------

export interface DirEntry {
  name: string;
  path: string;
  /** True when the folder is the root of a git repository. */
  git: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}

// ---- Projects (folders) and sessions --------------------------------------

export interface GitInfo {
  /** Current branch, or null for a detached HEAD. */
  branch: string | null;
}

export interface Project {
  id: string;
  path: string;
  name: string;
  /** Null when the folder is not inside a git repository. */
  git: GitInfo | null;
  lastOpenedAt: number;
}

export type SessionStatus = "idle" | "busy";

export interface Session {
  id: string;
  projectId: string;
  /** Null until the agent names the session (usually after the first prompt). */
  title: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface TextPart {
  id: string;
  type: "text";
  text: string;
}

export interface ToolPart {
  id: string;
  type: "tool";
  tool: string;
  title: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
}

export type Part = TextPart | ToolPart;

export type MessageStatus = "streaming" | "done" | "error" | "aborted";

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  createdAt: number;
  model?: ModelRef;
  status: MessageStatus;
  error?: string;
  parts: Part[];
}

export interface SessionDetail {
  session: Session;
  messages: Message[];
}

// ---- Providers (bring your own key) ----------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
}

export interface Provider {
  id: string;
  name: string;
  /** True once the agent holds what it needs to call this provider. */
  configured: boolean;
  /** Masked tail of the stored key, e.g. "••••3f9a". The key itself never leaves the agent. */
  keyHint: string | null;
  baseUrl: string | null;
  needsBaseUrl: boolean;
  keyOptional: boolean;
  /** When true the user may replace the model list (comma-separated IDs). */
  editableModels: boolean;
  models: ModelInfo[];
}

// ---- Request bodies --------------------------------------------------------

export interface CreateProjectBody {
  path: string;
}

export interface CreateSessionBody {
  title?: string;
}

export interface UpdateSessionBody {
  title: string;
}

export interface SendMessageBody {
  text: string;
  model: ModelRef;
}

export interface SendMessageResult {
  userMessageId: string;
  assistantMessageId: string;
}

/**
 * PUT /providers/:id. Omitted fields keep their stored value, so the UI can
 * change models or the base URL without asking for the key again.
 */
export interface SetProviderBody {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
}

export interface ApiErrorBody {
  error: string;
}

// ---- Event stream (GET /events, Server-Sent Events) -------------------------

export type AgentEvent =
  | { type: "server.connected"; info: ServerInfo }
  | { type: "project.updated"; project: Project }
  | { type: "project.deleted"; projectId: string }
  | { type: "session.updated"; session: Session }
  | { type: "session.deleted"; sessionId: string }
  /** Full snapshot of a message; sent when it is created and when it finishes. */
  | { type: "message.updated"; message: Message }
  /** A part was added or changed (e.g. a tool finished). */
  | { type: "part.updated"; sessionId: string; messageId: string; part: Part }
  /** Text appended to an existing text part while the model streams. */
  | { type: "part.delta"; sessionId: string; messageId: string; partId: string; delta: string }
  | { type: "provider.updated"; provider: Provider };
