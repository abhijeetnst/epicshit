// Forwards /api/agent/* to the local agent (DOPECODE_AGENT_URL). The browser
// only ever talks to this app; API keys typed into the UI pass through here
// straight to the agent and are not stored or logged by the web app.

import type { NextRequest } from "next/server";

const AGENT_URL = (process.env.DOPECODE_AGENT_URL ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.DOPECODE_AGENT_TOKEN;
const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(process.env.DOPECODE_WEB_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
]);

function hostnameOf(host: string) {
  const h = host.toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

/** Host (with port) of an Origin header; "" for "null" or anything unparsable. */
function hostOf(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function reject(status: number, error: string) {
  return Response.json({ error }, { status });
}

async function forward(req: NextRequest, ctx: RouteContext<"/api/agent/[...path]">) {
  // This route can store keys and (with a real agent) run commands, so only
  // same-origin requests to a local hostname get through: that blocks other
  // websites and DNS-rebinding attacks.
  const host = req.headers.get("host") ?? "";
  if (!ALLOWED_HOSTS.has(hostnameOf(host))) return reject(403, "Host not allowed.");
  const origin = req.headers.get("origin");
  if (origin !== null && hostOf(origin) !== host) return reject(403, "Cross-origin requests are not allowed.");

  const { path } = await ctx.params;
  const target = `${AGENT_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const name of ["content-type", "accept", "last-event-id"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (AGENT_TOKEN) headers.set("authorization", `Bearer ${AGENT_TOKEN}`);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      signal: req.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return reject(502, `Can't reach the agent at ${AGENT_URL}. Start it with "npm run dev:agent".`);
  }

  const out = new Headers();
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (out.get("content-type")?.startsWith("text/event-stream")) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  const noBody = upstream.status === 204 || upstream.status === 304;
  return new Response(noBody ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
