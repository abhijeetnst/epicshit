"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronRight, CircleAlert, CircleSlash, Loader } from "lucide-react";
import type { Message, ToolPart } from "@/lib/protocol";
import { useApp, type Tab } from "@/lib/store";
import { Composer, ContextRow } from "./composer";
import { CrabIcon, useSpriteCycle } from "./crabs/crabs";
import { altKey, cx, shortPath } from "./ui";
import { Wordmark } from "./wordmark";

export function SessionView({ tab }: { tab: Tab }) {
  const messages = useApp((s) => (tab.sessionId ? s.messages[tab.sessionId] : undefined));
  const connection = useApp((s) => s.connection);

  if (tab.sessionId && !messages) {
    return (
      <div className="relative z-10 grid flex-1 place-items-center">
        <div className="flex flex-col items-center gap-3 font-mono text-[12px] text-faint">
          <CrabIcon frame={connection === "offline" ? "sleep" : "think"} size={36} className="bob" />
          {connection === "offline" ? "Waiting for the agent…" : "Loading session…"}
        </div>
      </div>
    );
  }

  if (!messages?.length) {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[7vh]">
        <div className="relative mb-4 w-[min(520px,80vw)]">
          <div className="aura" aria-hidden />
          <Wordmark connection={connection} className="w-full" />
        </div>
        <StatusLine />
        <div className="rise w-full max-w-[880px]" style={{ animationDelay: "250ms" }}>
          <Composer tab={tab} autoFocus hero />
        </div>
        <div className="rise mt-5" style={{ animationDelay: "380ms" }}>
          <ContextRow tab={tab} />
        </div>
        <Shortcuts />
      </div>
    );
  }

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <Thread messages={messages} />
      <div className="mx-auto w-full max-w-[880px] shrink-0 px-4 pb-4">
        <Composer tab={tab} autoFocus />
        <div className="mt-2.5">
          <ContextRow tab={tab} />
        </div>
      </div>
    </div>
  );
}

/** One quiet line under the wordmark: which agent, what's running, which model. */
function StatusLine() {
  const info = useApp((s) => s.info);
  const connection = useApp((s) => s.connection);
  const model = useApp((s) => s.model);
  const running = useApp((s) => Object.values(s.sessions).filter((x) => x.status === "busy").length);
  const parts = [
    connection === "online" ? (info?.mock ? "mock agent" : (info?.name ?? "agent")) : connection === "offline" ? "agent offline" : "connecting",
    running ? `${running} running` : "all idle",
    model ? model.modelId : "no model yet",
  ];
  return (
    <p className="rise mb-10 flex items-center gap-2 font-mono text-[11.5px] text-faint" style={{ animationDelay: "650ms" }}>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="h-1 w-1 rounded-full bg-line-strong" />}
          <span className={cx(i === 1 && running > 0 && "text-accent-fg")}>{p}</span>
        </span>
      ))}
    </p>
  );
}

function Shortcuts() {
  const items: [string, string][] = [
    [altKey("T"), "new tab"],
    [altKey("W"), "close"],
    [altKey("O"), "open folder"],
    [altKey("K"), "keys"],
    [altKey("S"), "sessions"],
    [altKey("C"), "crabs"],
  ];
  return (
    <div className="rise mt-10 flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-[11px] text-faint" style={{ animationDelay: "650ms" }}>
      {items.map(([k, v]) => (
        <span key={v}>
          <span className="text-muted">{k}</span> {v}
        </span>
      ))}
    </div>
  );
}

function Thread({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the stream while the reader is at the bottom; stop once they scroll up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="scroll-thin min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[820px] space-y-8 px-6 pb-10 pt-10">
        {messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} message={m} /> : <AssistantMessage key={m.id} message={m} />))}
      </div>
    </div>
  );
}

const UserMessage = memo(function UserMessage({ message }: { message: Message }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  return (
    <div className="rise flex justify-end">
      <div className="max-w-[86%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5 text-[15px] leading-relaxed text-ink shadow-[0_12px_30px_-18px_rgb(0_0_0/0.6)]">
        {text}
      </div>
    </div>
  );
});

function AssistantMessage({ message }: { message: Message }) {
  const streaming = message.status === "streaming";
  const last = message.parts[message.parts.length - 1];
  const reading = streaming && last?.type === "tool" && last.status === "running";
  const cycled = useSpriteCycle(streaming, reading ? ["readA", "readB"] : ["typeA", "typeB"], reading ? 2 : 8);
  const frame = cycled ?? (message.status === "error" ? "dizzy" : "stand");

  return (
    <div className="rise grid grid-cols-[32px_1fr] gap-x-3">
      <div className="pt-1">
        <CrabIcon frame={frame} size={28} />
      </div>
      <div className="min-w-0 space-y-3">
        {message.parts.map((part) =>
          part.type === "text" ? (
            <MarkdownBlock key={part.id} text={part.text} streaming={streaming && part === last} />
          ) : (
            <ToolCard key={part.id} part={part} />
          ),
        )}
        {streaming && (!last || last.type === "tool") && <span className="caret block h-5" aria-label="Working" />}
        <MessageFooter message={message} />
      </div>
    </div>
  );
}

const MarkdownBlock = memo(function MarkdownBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className={cx("md text-ink/95", streaming && "streaming")}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text || " "}
      </Markdown>
    </div>
  );
});

function ToolCard({ part }: { part: ToolPart }) {
  const home = useApp((s) => s.info?.home);
  // Failed tools start expanded; after a click the reader's choice wins.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? part.status === "error";
  const lines = part.output ? part.output.split("\n").length : 0;
  const running = part.status === "running";

  return (
    <div
      className={cx(
        "overflow-hidden rounded-lg border font-mono text-[12.5px] transition-colors duration-500",
        running ? "shimmer border-accent/40 bg-raised/60" : "border-line bg-raised/50",
      )}
    >
      <button
        type="button"
        onClick={() => setToggled(!open)}
        disabled={!part.output}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left enabled:hover:bg-hover/60"
      >
        <ToolStatus status={part.status} />
        <span className="text-ink">{part.tool}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{shortPath(part.title, home)}</span>
        {running && <span className="shrink-0 text-accent-fg">running…</span>}
        {part.output && (
          <span className="shrink-0 text-faint">
            {lines} {lines === 1 ? "line" : "lines"}
          </span>
        )}
        {part.output && <ChevronRight size={13} className={cx("shrink-0 text-faint transition-transform duration-200", open && "rotate-90")} />}
      </button>
      <div className={cx("grid transition-[grid-template-rows] duration-300 ease-out", open && part.output ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          {part.output && (
            <pre className="scroll-thin max-h-72 overflow-auto border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-muted">
              {part.output}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolStatus({ status }: { status: ToolPart["status"] }) {
  if (status === "running") return <Loader size={13} className="spin shrink-0 text-accent-fg" aria-label="Running" />;
  if (status === "error") return <CircleAlert size={13} className="shrink-0 text-danger" aria-label="Failed" />;
  return <Check size={13} className="shrink-0 text-ok" aria-label="Done" />;
}

function MessageFooter({ message }: { message: Message }) {
  if (message.status === "streaming") return null;
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
      {message.status === "aborted" && (
        <span className="flex items-center gap-1 text-muted">
          <CircleSlash size={11} /> stopped
        </span>
      )}
      {message.status === "error" && (
        <span className="flex items-center gap-1 text-danger">
          <CircleAlert size={11} /> {message.error ?? "failed"}
        </span>
      )}
      {message.model && (
        <span>
          {message.model.providerId}/{message.model.modelId}
        </span>
      )}
    </div>
  );
}
