"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CRAB_CELLS, activateTab, setChime, setCrabSize, setCrabs, useApp, type CrabSize } from "@/lib/store";
import { altKey, cx, useDismiss } from "../ui";
import { CrabEngine, type CrabAgent, type Job } from "./engine";
import { COLORS, FRAMES, LAYERS, type FrameName } from "./sprites";

type AppState = ReturnType<typeof useApp.getState>;

// Tools that look things up rather than change them: their crab reads instead of types.
const READ_TOOLS = new Set(["read", "list", "ls", "glob", "grep", "search", "find", "fetch", "webfetch", "websearch", "toolsearch", "tasklist", "taskget", "view", "cat"]);

function agentsFrom(s: AppState): CrabAgent[] {
  return s.tabs.map((tab, index) => {
    const session = tab.sessionId ? s.sessions[tab.sessionId] : undefined;
    const project = tab.projectId ? s.projects[tab.projectId] : undefined;
    const last = session ? s.messages[session.id]?.at(-1) : undefined;
    let job: Job = "idle";
    let detail = "idle";
    if (s.connection === "offline") {
      job = "offline";
      detail = "agent offline";
    } else if (session?.status === "busy") {
      const part = last?.role === "assistant" ? last.parts.at(-1) : undefined;
      if (part?.type === "tool" && part.status === "running") {
        job = READ_TOOLS.has(part.tool.toLowerCase()) ? "read" : "type";
        detail = part.tool;
      } else if (part?.type === "text") {
        job = "type";
        detail = "writing";
      } else {
        job = "think";
        detail = "thinking";
      }
    } else if (last?.role === "assistant" && last.status === "error") {
      job = "error";
      detail = "error";
    }
    return {
      id: tab.id,
      index,
      title: session?.title ?? (tab.sessionId ? "New session" : "New tab"),
      folder: project?.name ?? null,
      job,
      detail,
      active: tab.id === s.activeTabId,
      lastStatus: last?.role === "assistant" ? last.status : null,
    };
  });
}

/**
 * Full-screen layer the crabs live on. Mount once, only while crabs are on.
 * There is exactly one crab per open session tab: open a third session and a
 * third crab drops in; close one and its crab leaves.
 */
export function Crabs() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CrabEngine | null>(null);
  const size = useApp((s) => s.crabSize);

  useEffect(() => {
    const engine = new CrabEngine(rootRef.current!, { onOpen: activateTab }, CRAB_CELLS[useApp.getState().crabSize]);
    engineRef.current = engine;
    let key = "";
    const sync = (s: AppState) => {
      const agents = agentsFrom(s);
      // Deltas stream in many times a second; only resync when something a crab shows changed.
      const next = JSON.stringify(agents);
      if (next === key) return;
      key = next;
      engine.sync(agents);
    };
    sync(useApp.getState());
    const unsubscribe = useApp.subscribe(sync);
    return () => {
      unsubscribe();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setScale(CRAB_CELLS[size]);
  }, [size]);

  return <div ref={rootRef} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden" />;
}

/** Soft two-note chime when a background tab's turn finishes (off by default). */
export function useFinishChime() {
  useEffect(() => {
    let audio: AudioContext | null = null;
    const play = () => {
      try {
        audio ??= new AudioContext();
        if (audio.state === "suspended") void audio.resume();
        const t = audio.currentTime;
        [659.25, 987.77].forEach((freq, i) => {
          const osc = audio!.createOscillator();
          const gain = audio!.createGain();
          const at = t + i * 0.12;
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.07, at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
          osc.connect(gain).connect(audio!.destination);
          osc.start(at);
          osc.stop(at + 0.45);
        });
      } catch {
        // No audio available; the chime is a nicety.
      }
    };

    let busy = new Set<string>();
    const unsubscribe = useApp.subscribe((s) => {
      const now = new Set(Object.values(s.sessions).filter((x) => x.status === "busy").map((x) => x.id));
      if (s.chime) {
        const activeSession = s.tabs.find((t) => t.id === s.activeTabId)?.sessionId;
        for (const id of busy) {
          const finished = !now.has(id) && s.messages[id]?.at(-1)?.status === "done";
          if (finished && (id !== activeSession || document.hidden)) {
            play();
            break;
          }
        }
      }
      busy = now;
    });
    return () => {
      unsubscribe();
      void audio?.close();
    };
  }, []);
}

/** A still crab for UI chrome. */
export function CrabIcon({ frame = "stand", size = 24, className }: { frame?: FrameName; size?: number; className?: string }) {
  const f = FRAMES[frame];
  return (
    <svg
      viewBox="0 0 16 10"
      width={size}
      height={(size * 10) / 16}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      {LAYERS.map((l) => (f[l] ? <path key={l} d={f[l]} fill={COLORS[l]} /> : null))}
    </svg>
  );
}

/** Cycles through frames while `active`, e.g. typing while the agent streams. */
export function useSpriteCycle(active: boolean, frames: FrameName[], fps = 6) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => n + 1), 1000 / fps);
    return () => clearInterval(t);
  }, [active, fps]);
  return active ? frames[i % frames.length] : null;
}

const LEGEND: [FrameName, string][] = [
  ["think", "thinking"],
  ["typeA", "writing or running a command"],
  ["readA", "reading files"],
  ["happy", "turn finished"],
  ["dizzy", "hit an error"],
  ["sleep", "idle a while, or agent offline"],
];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] text-ink hover:bg-hover"
    >
      <span className="flex-1">{label}</span>
      <span
        className={cx(
          "relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] h-3 w-3 rounded-full bg-surface shadow transition-transform duration-200",
            checked ? "translate-x-[17px]" : "translate-x-[3px]",
          )}
        />
      </span>
    </button>
  );
}

const SIZES: [CrabSize, string][] = [
  ["small", "S"],
  ["medium", "M"],
  ["large", "L"],
];

/** Tab-bar control for the crabs and the finish chime. */
export function CrabMenu() {
  const crabs = useApp((s) => s.crabs);
  const size = useApp((s) => s.crabSize);
  const chime = useApp((s) => s.chime);
  const sessions = useApp((s) => s.tabs.length);
  const working = useApp((s) => Object.values(s.sessions).some((x) => x.status === "busy"));
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const frame = useSpriteCycle(working, ["typeA", "typeB"], 8) ?? (crabs ? "stand" : "sleep");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Crabs: ${crabs ? `${sessions} for ${sessions} session${sessions === 1 ? "" : "s"}` : "off"} (${altKey("C")})`}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-hover"
      >
        <CrabIcon frame={frame} size={22} className={cx(!crabs && "opacity-50 grayscale")} />
        <span className={cx("font-mono text-[11px]", crabs ? "text-muted" : "text-faint line-through")}>×{sessions}</span>
      </button>
      {open && (
        <div role="menu" className="pop-in absolute right-0 top-full z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
          <div className="flex items-baseline justify-between px-3.5 pb-1 pt-3.5">
            <span className="font-pixel text-[11px] uppercase tracking-[0.08em] text-ink">Crabs</span>
            <span className="font-mono text-[11px] text-accent-fg">
              {sessions} session{sessions === 1 ? "" : "s"} · {crabs ? sessions : 0} crab{crabs && sessions === 1 ? "" : "s"}
            </span>
          </div>
          <p className="px-3.5 pb-3 text-[12.5px] leading-snug text-muted">
            One crab per open session, numbered like its tab, acting out what that session is doing. Click a crab to jump
            to its tab; drag one to move it.
          </p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-2 border-y border-line px-3.5 py-3">
            {LEGEND.map(([f, label]) => (
              <div key={label} className="flex items-center gap-2 text-[11.5px] leading-tight text-muted">
                <CrabIcon frame={f} size={20} className="shrink-0" />
                {label}
              </div>
            ))}
          </div>
          <div className="p-1.5">
            <Switch checked={crabs} onChange={setCrabs} label="Show crabs" />
            <div className="flex items-center gap-3 px-2 py-2 text-[13px] text-ink">
              <span className="flex-1">Size</span>
              <div role="radiogroup" aria-label="Crab size" className="flex rounded-md border border-line p-0.5">
                {SIZES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={size === value}
                    aria-label={value}
                    onClick={() => setCrabSize(value)}
                    className={cx(
                      "h-6 w-7 rounded font-mono text-[11px] transition-colors",
                      size === value ? "bg-accent text-accent-ink" : "text-muted hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Switch checked={chime} onChange={setChime} label="Chime when a background tab finishes" />
          </div>
        </div>
      )}
    </div>
  );
}
