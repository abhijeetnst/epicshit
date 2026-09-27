"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { KeyRound, LayoutGrid, PencilLine, Plus, X } from "lucide-react";
import { activateTab, closeTab, newTab, openDialog, renameSession, useApp, type Tab } from "@/lib/store";
import { CrabIcon, CrabMenu } from "./crabs/crabs";
import { IconButton, PixelLoader, ProjectAvatar, altKey, cx } from "./ui";

const SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.8 } as const;

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      stripRef.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [activeTabId, tabs.length]);

  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-1 pl-2 pr-2">
      <Brand />
      <IconButton label={`Sessions and folders (${altKey("S")})`} onClick={() => openDialog({ kind: "sessions" })}>
        <LayoutGrid size={16} strokeWidth={1.75} />
      </IconButton>

      <div ref={stripRef} role="tablist" aria-label="Sessions" className="no-scrollbar flex min-w-0 items-center overflow-x-auto pl-1">
        <LayoutGroup>
          <AnimatePresence initial={false}>
            {tabs.map((tab, i) => (
              <motion.div
                key={tab.id}
                layout="position"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={SPRING}
                className="flex shrink-0 items-center overflow-hidden"
              >
                <span
                  className={cx(
                    "mx-0.5 h-4 w-px shrink-0 transition-colors",
                    i > 0 && i !== activeIndex && i - 1 !== activeIndex ? "bg-line-strong" : "bg-transparent",
                  )}
                  aria-hidden
                />
                <TabItem tab={tab} index={i} active={tab.id === activeTabId} />
              </motion.div>
            ))}
          </AnimatePresence>
        </LayoutGroup>
      </div>
      <IconButton label={`New session in this folder (${altKey("T")})`} onClick={() => newTab()} className="group">
        <Plus size={16} strokeWidth={1.75} className="transition-transform duration-300 group-hover:rotate-90" />
      </IconButton>

      <div className="flex-1" />
      <AgentStatus />
      <CrabMenu />
      <KeysButton />
    </header>
  );
}

function Brand() {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="mr-1 flex items-center gap-2 pl-1.5 pr-1.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="DopeCode"
    >
      <CrabIcon frame={hover ? "happy" : "stand"} size={22} className={cx("transition-transform duration-200", hover && "-translate-y-0.5")} />
      <span className="hidden font-pixel text-[12px] tracking-wide text-accent-fg md:inline">
        dope<span className="text-muted">code</span>
      </span>
    </div>
  );
}

function TabItem({ tab, index, active }: { tab: Tab; index: number; active: boolean }) {
  const session = useApp((s) => (tab.sessionId ? s.sessions[tab.sessionId] : undefined));
  const project = useApp((s) => (tab.projectId ? s.projects[tab.projectId] : undefined));
  const [editing, setEditing] = useState(false);

  const title = tab.sessionId ? (session?.title ?? "New session") : "Session";
  const busy = session?.status === "busy";

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={project ? `${title}\n${project.path}` : title}
      onClick={() => activateTab(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activateTab(tab.id);
        }
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
        }
      }}
      onDoubleClick={() => tab.sessionId && setEditing(true)}
      className={cx(
        "group relative flex h-8 w-[208px] items-center gap-2 rounded-md pl-2 pr-1 text-[13px] transition-colors select-none",
        active ? "text-ink" : "text-muted hover:bg-hover/70 hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="active-tab"
          transition={SPRING}
          className="absolute inset-0 rounded-md bg-raised shadow-[0_0_0_1px_var(--line),inset_0_-1.5px_0_0_var(--accent)]"
          aria-hidden
        />
      )}
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2">
        {tab.sessionId ? (
          <span className={cx("rounded-[5px] transition-shadow", busy && "shadow-[0_0_0_1.5px_var(--accent)]")}>
            <ProjectAvatar name={project?.name} size={17} />
          </span>
        ) : (
          <PencilLine size={14} strokeWidth={1.75} className="shrink-0" />
        )}
        {editing && session ? (
          <input
            autoFocus
            defaultValue={session.title ?? ""}
            aria-label="Session title"
            className="min-w-0 flex-1 rounded bg-surface px-1 text-[13px] text-ink outline-none ring-1 ring-accent"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              setEditing(false);
              if (value && value !== session.title) void renameSession(session.id, value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = session.title ?? "";
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{title}</span>
        )}
        {busy ? (
          <PixelLoader className="mr-1 shrink-0" />
        ) : (
          index < 9 &&
          !editing && <span className="hidden font-mono text-[10.5px] text-faint group-hover:hidden lg:inline">{index + 1}</span>
        )}
        <button
          type="button"
          aria-label="Close tab"
          title={`Close tab (${altKey("W")})`}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
          className={cx(
            "grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-hover hover:text-ink",
            active ? "opacity-100" : "hidden group-hover:grid",
          )}
        >
          <X size={13} />
        </button>
      </span>
    </div>
  );
}

function AgentStatus() {
  const connection = useApp((s) => s.connection);
  const info = useApp((s) => s.info);
  const error = useApp((s) => s.connectionError);
  const label =
    connection === "online" ? (info?.mock ? "mock agent" : (info?.name ?? "agent")) : connection === "connecting" ? "connecting" : "agent offline";
  return (
    <div
      className="mr-1 hidden items-center gap-2 whitespace-nowrap rounded-md px-2 font-mono text-[11.5px] text-muted lg:flex"
      title={connection === "offline" ? (error ?? "The agent isn't reachable") : info ? `${info.name} ${info.version}` : undefined}
    >
      <span className="relative grid h-2 w-2 place-items-center">
        {connection === "online" && <span className="absolute inset-0 animate-ping rounded-full bg-ok/60" />}
        <span
          className={cx(
            "relative h-1.5 w-1.5 rounded-full",
            connection === "online" && "bg-ok",
            connection === "connecting" && "bg-faint",
            connection === "offline" && "bg-danger",
          )}
        />
      </span>
      {label}
    </div>
  );
}

function KeysButton() {
  const providers = useApp((s) => s.providers);
  const configured = providers.filter((p) => p.configured).length;
  return (
    <button
      type="button"
      onClick={() => openDialog({ kind: "providers" })}
      title={`API keys (${altKey("K")})`}
      className={cx(
        "flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors",
        configured ? "text-muted hover:bg-hover hover:text-ink" : "bg-accent text-accent-ink hover:brightness-110",
      )}
    >
      <KeyRound size={14} strokeWidth={1.9} />
      <span>{configured ? "Keys" : "Add API key"}</span>
      {configured > 0 && <span className="rounded bg-line-strong px-1.5 font-mono text-[10.5px] text-ink">{configured}</span>}
    </button>
  );
}
