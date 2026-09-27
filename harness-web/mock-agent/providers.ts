// Provider catalog and the key store behind bring-your-own-key. Keys are
// written to $DOPECODE_DATA_DIR/auth.json (mode 0600) and only ever leave this
// process as a masked hint. The mock never calls a provider with them.

import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo, Provider, SetProviderBody } from "../lib/protocol";
import { DATA_DIR } from "./store";

const AUTH_FILE = join(DATA_DIR, "auth.json");

interface CatalogEntry {
  id: string;
  name: string;
  needsBaseUrl: boolean;
  keyOptional: boolean;
  defaultBaseUrl: string | null;
  defaultModels: ModelInfo[];
}

const CATALOG: CatalogEntry[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModels: [
      { id: "deepseek-flash", name: "DeepSeek Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ],
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba Cloud Model Studio)",
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModels: [
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
      { id: "qwen-max", name: "Qwen Max" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: null,
    defaultModels: [
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 mini" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    needsBaseUrl: false,
    keyOptional: false,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModels: [],
  },
  {
    id: "openai-compatible",
    name: "OpenAI-compatible (vLLM, Ollama, LM Studio…)",
    needsBaseUrl: true,
    keyOptional: true,
    defaultBaseUrl: null,
    defaultModels: [],
  },
];

interface StoredCredential {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
}

let auth: Record<string, StoredCredential> = {};

export function loadAuth() {
  try {
    auth = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
  } catch {
    auth = {};
  }
}

function saveAuth() {
  const tmp = `${AUTH_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(auth, null, 2), { mode: 0o600 });
  renameSync(tmp, AUTH_FILE);
  chmodSync(AUTH_FILE, 0o600);
}

export const KEY_STORAGE_NOTE = `${AUTH_FILE} (readable only by your user)`;

function maskKey(key: string) {
  return key.length >= 8 ? `••••${key.slice(-4)}` : "••••";
}

function toProvider(entry: CatalogEntry): Provider {
  const cred = auth[entry.id] ?? {};
  const baseUrl = cred.baseUrl ?? entry.defaultBaseUrl;
  const models = cred.models ? cred.models.map((id) => ({ id, name: id })) : entry.defaultModels;
  const configured = entry.needsBaseUrl ? Boolean(cred.baseUrl) : Boolean(cred.apiKey);
  return {
    id: entry.id,
    name: entry.name,
    configured,
    keyHint: cred.apiKey ? maskKey(cred.apiKey) : null,
    baseUrl,
    needsBaseUrl: entry.needsBaseUrl,
    keyOptional: entry.keyOptional,
    editableModels: true,
    models,
  };
}

export function listProviders(): Provider[] {
  return CATALOG.map(toProvider);
}

export function getProvider(id: string): Provider | null {
  const entry = CATALOG.find((e) => e.id === id);
  return entry ? toProvider(entry) : null;
}

export class InputError extends Error {}

export function setProvider(id: string, body: SetProviderBody): Provider {
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) throw new InputError(`Unknown provider: ${id}`);
  const next: StoredCredential = { ...auth[id] };

  if (body.apiKey !== undefined) {
    const key = String(body.apiKey).trim();
    if (key) {
      if (key.length > 512 || /\s/.test(key)) throw new InputError("That doesn't look like an API key.");
      next.apiKey = key;
    }
  }
  if (body.baseUrl !== undefined) {
    const raw = String(body.baseUrl).trim();
    if (raw) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new InputError("Base URL must be a full http(s) URL.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new InputError("Base URL must use http or https.");
      next.baseUrl = raw.replace(/\/+$/, "");
    } else {
      delete next.baseUrl;
    }
  }
  if (body.models !== undefined) {
    if (!Array.isArray(body.models)) throw new InputError("models must be a list of model IDs.");
    const models = [...new Set(body.models.map((m) => String(m).trim()).filter(Boolean))];
    if (models.length > 50 || models.some((m) => m.length > 200)) throw new InputError("Too many or too long model IDs.");
    if (models.length) next.models = models;
    else delete next.models;
  }

  if (entry.needsBaseUrl && !next.baseUrl) throw new InputError(`${entry.name} needs a base URL.`);
  if (!entry.keyOptional && !next.apiKey) throw new InputError(`Enter an API key for ${entry.name}.`);
  if (!entry.defaultModels.length && !next.models?.length) {
    throw new InputError(`Add at least one model ID for ${entry.name}.`);
  }

  auth[id] = next;
  saveAuth();
  return toProvider(entry);
}

export function clearProvider(id: string): Provider {
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) throw new InputError(`Unknown provider: ${id}`);
  delete auth[id];
  saveAuth();
  return toProvider(entry);
}
