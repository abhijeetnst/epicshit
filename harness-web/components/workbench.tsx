"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, X } from "lucide-react";
import {
  activateTab,
  closeTab,
  dismissToast,
  newTab,
  openDialog,
  setCrabs,
  start,
  useApp,
} from "@/lib/store";
import { Crabs, useFinishChime } from "./crabs/crabs";
import { FolderPicker } from "./folder-picker";
import { ProvidersDialog } from "./providers-dialog";
import { SessionView } from "./session-view";
import { SessionsDialog } from "./sessions-dialog";
import { TabBar } from "./tab-bar";

export function Workbench() {
  useEffect(() => start(), []);
  useShortcuts();
  useFinishChime();

  const ready = useApp((s) => s.ready);
  const crabs = useApp((s) => s.crabs);
  const activeTab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const dialog = useApp((s) => s.dialog);

  if (!ready) return <div className="h-full bg-bg" />;

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      <main className="grain relative mx-2 mb-2 flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface">
        <Backdrop />
        <OfflineBanner />
        {activeTab && <SessionView key={activeTab.id} tab={activeTab} />}
      </main>
      <FolderPicker open={dialog?.kind === "folder"} target={dialog?.kind === "folder" ? dialog.target : "active"} />
      <ProvidersDialog open={dialog?.kind === "providers"} focus={dialog?.kind === "providers" ? dialog.focus : undefined} />
      <SessionsDialog open={dialog?.kind === "sessions"} />
      {crabs && <Crabs />}
      <Toasts />
    </div>
  );
}

/** Dot grid across the canvas, lit lime around the cursor. */
function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    const main = layer?.parentElement;
    if (!layer || !main) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      const r = main.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          layer.style.setProperty("--mx", `${x}px`);
          layer.style.setProperty("--my", `${y}px`);
        });
      }
    };
    const onLeave = () => {
      layer.style.setProperty("--mx", "-9999px");
      layer.style.setProperty("--my", "-9999px");
    };
    main.addEventListener("pointermove", onMove);
    main.addEventListener("pointerleave", onLeave);
    return () => {
      main.removeEventListener("pointermove", onMove);
      main.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <div className="dots opacity-60" />
      <div className="dots dots-lit" />
    </div>
  );
}

function OfflineBanner() {
  const connection = useApp((s) => s.connection);
  const error = useApp((s) => s.connectionError);
  return (
    <AnimatePresence>
      {connection === "offline" && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="relative z-20 overflow-hidden rounded-t-xl"
        >
          <div className="flex items-center gap-2 border-b border-danger/25 bg-danger/[0.07] px-4 py-2 text-[13px] text-danger">
            <CircleAlert size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{error ?? "Lost the connection to the agent. Retrying…"}</span>
            <span className="blink shrink-0 font-pixel text-[10px] text-danger/80">retrying</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 480, damping: 32 }}
            className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-xl border border-line-strong bg-raised px-3.5 py-2.5 text-[13px] text-ink shadow-[var(--shadow)]"
          >
            <CircleAlert size={14} className="shrink-0 text-accent-fg" />
            <span className="min-w-0 flex-1">{t.text}</span>
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-faint hover:text-ink">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Alt/Option shortcuts; browsers keep Cmd/Ctrl+T and +W for themselves. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const { tabs, activeTabId, dialog, crabs } = useApp.getState();
      const index = tabs.findIndex((t) => t.id === activeTabId);
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.code.startsWith("Digit")) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && tabs[n - 1]) act(() => activateTab(tabs[n - 1].id));
        return;
      }
      if (dialog && e.code !== "KeyK" && e.code !== "KeyS" && e.code !== "KeyO") return;
      switch (e.code) {
        case "KeyT":
          return act(() => newTab());
        case "KeyW":
          return act(() => activeTabId && closeTab(activeTabId));
        case "KeyO":
          return act(() => openDialog({ kind: "folder", target: "active" }));
        case "KeyK":
          return act(() => openDialog({ kind: "providers" }));
        case "KeyS":
          return act(() => openDialog({ kind: "sessions" }));
        case "KeyC":
          return act(() => setCrabs(!crabs));
        case "BracketLeft":
          return act(() => tabs[index - 1] && activateTab(tabs[index - 1].id));
        case "BracketRight":
          return act(() => tabs[index + 1] && activateTab(tabs[index + 1].id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
