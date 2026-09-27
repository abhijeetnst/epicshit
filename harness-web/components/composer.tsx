"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, FolderOpen, GitBranch, KeyRound, Monitor, Square } from "lucide-react";
import {
  abort,
  availableModels,
  newTab,
  openDialog,
  recentProjects,
  send,
  setModel,
  setTabProject,
  useApp,
  type Tab,
} from "@/lib/store";
import { PixelLoader, ProjectAvatar, altKey, cx, shortPath, useDismiss } from "./ui";

// Unsent text per tab, kept while the page is open so switching tabs doesn't lose it.
const drafts = new Map<string, string>();

const SUGGESTIONS = [
  "Map out how this codebase is organized",
  "Find the flakiest test and tell me why it flakes",
  "Add input validation to the signup form",
  "Write a README a new teammate would actually read",
  "Refactor the gnarliest function you can find",
];

const CHIPS: [string, string][] = [
  ["Map this codebase", SUGGESTIONS[0]],
  ["Hunt a flaky test", SUGGESTIONS[1]],
  ["Write the README", SUGGESTIONS[3]],
];

/** Types and erases each line in turn, for the empty prompt's placeholder. */
function useTypewriter(lines: string[] | null) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!lines) return;
    let line = 0;
    let n = 0;
    let dir = 1;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const current = lines[line % lines.length];
      n += dir;
      setTyped(current.slice(0, n));
      let delay = dir > 0 ? 34 + Math.random() * 46 : 16;
      if (dir > 0 && n >= current.length) {
        dir = -1;
        delay = 2100;
      } else if (dir < 0 && n <= 0) {
        dir = 1;
        line++;
        delay = 380;
      }
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, 700);
    return () => clearTimeout(timer);
  }, [lines]);
  return lines ? typed : null;
}

export function Composer({ tab, autoFocus, hero }: { tab: Tab; autoFocus?: boolean; hero?: boolean }) {
  const session = useApp((s) => (tab.sessionId ? s.sessions[tab.sessionId] : undefined));
  const busy = session?.status === "busy";
  const [text, setTextState] = useState(() => drafts.get(tab.id) ?? "");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const typed = useTypewriter(hero && !text && tab.projectId ? SUGGESTIONS : null);

  const setText = (value: string) => {
    setTextState(value);
    if (value) drafts.set(tab.id, value);
    else drafts.delete(tab.id);
  };

  // CSS field-sizing grows the box with its content; measure by hand only
  // where that isn't supported (Firefox).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, tab.id]);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy || sending) return;
    setSending(true);
    setText("");
    const ok = await send(tab.id, value);
    setSending(false);
    if (!ok) {
      setTextState((current) => {
        const restored = current || value;
        drafts.set(tab.id, restored);
        return restored;
      });
    }
    ref.current?.focus();
  };

  const canSend = !!text.trim() && !busy && !sending;
  const placeholder = !tab.projectId
    ? "Open a folder first, then ask anything…"
    : typed !== null
      ? `${typed}▍`
      : "Ask anything…";

  return (
    <div>
      <div className="ring" data-busy={busy} data-perch="composer">
        <div className="relative rounded-[14px] bg-raised">
          <textarea
            ref={ref}
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape" && busy && session) {
                e.preventDefault();
                void abort(session.id);
              } else if (e.key === "Tab" && !text && typed) {
                // Tab accepts the suggestion being typed.
                e.preventDefault();
                setText(SUGGESTIONS.find((s) => s.startsWith(typed)) ?? typed);
              }
            }}
            placeholder={placeholder}
            className="block max-h-[260px] min-h-[62px] w-full resize-none bg-transparent [field-sizing:content] px-4 pt-3.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint"
            aria-label="Prompt"
          />
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <ModelPicker />
            <div className="flex-1" />
            {!busy && (
              <span className="mr-1.5 hidden font-mono text-[10.5px] text-faint sm:inline">
                {typed ? "tab to use · " : ""}↵ send · ⇧↵ new line
              </span>
            )}
            {busy && session ? (
              <button
                type="button"
                onClick={() => void abort(session.id)}
                title="Stop (Esc)"
                aria-label="Stop"
                className="flex h-8 items-center gap-2.5 rounded-lg bg-accent-soft px-3 font-mono text-[11.5px] text-accent-fg transition-colors hover:bg-accent/20"
              >
                <PixelLoader />
                working
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                aria-label="Send"
                title="Send (Enter)"
                className={cx(
                  "grid h-8 w-8 place-items-center rounded-lg transition-all duration-200 active:scale-90",
                  canSend
                    ? "bg-accent text-accent-ink shadow-[0_0_22px_-4px_var(--accent)] hover:-translate-y-px"
                    : "bg-hover text-faint",
                )}
              >
                <ArrowUp size={16} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>
      {hero && tab.projectId && !text && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {CHIPS.map(([label, full], i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setText(full);
                ref.current?.focus();
              }}
              style={{ animationDelay: `${500 + i * 90}ms` }}
              className="rise rounded-full border border-line px-3 py-1 text-[12.5px] text-muted transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:text-ink"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelPicker() {
  const providers = useApp((s) => s.providers);
  const model = useApp((s) => s.model);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  const options = useMemo(() => availableModels(providers), [providers]);
  const current = options.find((o) => o.provider.id === model?.providerId && o.model.id === model?.modelId);

  if (!options.length) {
    return (
      <button
        type="button"
        onClick={() => openDialog({ kind: "providers" })}
        className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-accent-fg transition-colors hover:bg-accent-soft"
      >
        <KeyRound size={14} strokeWidth={1.75} />
        Add an API key to pick a model
      </button>
    );
  }

  const groups = providers.filter((p) => p.configured && p.models.length);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <span className="grid h-4 w-4 place-items-center rounded-[3px] border border-line-strong font-mono text-[9px] text-muted">
          {current?.provider.name.charAt(0) ?? "?"}
        </span>
        <span className="max-w-[220px] truncate text-ink">{current?.model.name ?? "Pick a model"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div role="menu" className="pop-in absolute bottom-full left-0 origin-bottom-left z-30 mb-2 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
          <div className="scroll-thin max-h-80 overflow-y-auto py-1.5">
            {groups.map((p) => (
              <div key={p.id} className="py-1">
                <div className="px-3 pb-1 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
                  {p.name} <span className="normal-case tracking-normal">{p.keyHint}</span>
                </div>
                {p.models.map((m) => {
                  const selected = model?.providerId === p.id && model.modelId === m.id;
                  return (
                    <button
                      key={m.id}
                      role="menuitemradio"
                      aria-checked={selected}
                      type="button"
                      onClick={() => {
                        setModel({ providerId: p.id, modelId: m.id });
                        close();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {m.name !== m.id && <span className="max-w-[40%] truncate font-mono text-[10.5px] text-faint">{m.id}</span>}
                      <Check size={13} className={selected ? "text-accent-fg" : "invisible"} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              close();
              openDialog({ kind: "providers" });
            }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-[13px] text-muted hover:bg-hover hover:text-ink"
          >
            <KeyRound size={13} /> Manage API keys
            <span className="ml-auto font-mono text-[10.5px] text-faint">{altKey("K")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The folder chip and git badge under the prompt. */
export function ContextRow({ tab }: { tab: Tab }) {
  const projectsById = useApp((s) => s.projects);
  const home = useApp((s) => s.info?.home);
  const project = tab.projectId ? projectsById[tab.projectId] : undefined;
  const projects = useMemo(() => recentProjects(projectsById), [projectsById]);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  const choose = (projectId: string) => {
    close();
    if (projectId === tab.projectId) return;
    // A session belongs to its folder; picking another folder starts a new tab there.
    if (tab.sessionId) newTab(projectId);
    else setTabProject(tab.id, projectId);
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <div ref={ref} className="relative">
        {project ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            title={project.path}
            className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <ProjectAvatar name={project.name} size={17} />
            <span className="max-w-[260px] truncate text-ink/90">{project.name}</span>
            <ChevronDown size={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openDialog({ kind: "folder", target: "active" })}
            className="flex h-8 items-center gap-2 rounded-lg bg-accent-soft px-3 text-[13px] text-accent-fg transition-colors hover:bg-accent/20"
          >
            <FolderOpen size={14} /> Open a folder
          </button>
        )}
        {open && (
          <div role="menu" className="pop-in absolute bottom-full left-1/2 origin-bottom z-30 mb-2 w-80 -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
            <div className="px-3 pb-1 pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
              {tab.sessionId ? "Start a session in" : "Folder for this session"}
            </div>
            <div className="scroll-thin max-h-72 overflow-y-auto pb-1.5">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.id === tab.projectId}
                  onClick={() => choose(p.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover"
                >
                  <ProjectAvatar name={p.name} size={17} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{p.name}</span>
                    <span className="block truncate font-mono text-[10.5px] text-faint">{shortPath(p.path, home)}</span>
                  </span>
                  <Check size={13} className={p.id === tab.projectId ? "text-accent-fg" : "invisible"} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                close();
                openDialog({ kind: "folder", target: "active" });
              }}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-[13px] text-muted hover:bg-hover hover:text-ink"
            >
              <FolderOpen size={13} /> Open folder…
              <span className="ml-auto font-mono text-[10.5px] text-faint">{altKey("O")}</span>
            </button>
          </div>
        )}
      </div>

      {project && (
        <span
          className="flex h-7 items-center gap-1.5 rounded-lg bg-hover/70 px-2.5 text-[12.5px] text-muted"
          title={project.git ? "Git repository" : "This folder isn't in a git repository"}
        >
          {project.git ? <GitBranch size={13} /> : <Monitor size={13} />}
          {project.git ? (project.git.branch ?? "detached HEAD") : "No Git"}
        </span>
      )}
    </div>
  );
}
