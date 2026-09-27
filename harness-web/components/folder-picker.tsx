"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronRight, Folder, FolderGit2, House } from "lucide-react";
import { api } from "@/lib/api";
import type { DirListing } from "@/lib/protocol";
import { closeDialog, openFolder, recentProjects, useApp } from "@/lib/store";
import { Button, IconButton, ProjectAvatar, Sheet, cx, shortPath } from "./ui";

export function FolderPicker({ open, target }: { open: boolean; target: "active" | "new" }) {
  return (
    <Sheet
      open={open}
      onClose={closeDialog}
      title="Open folder"
      subtitle="Pick the folder the agent should work in. Every tab you open for it is a separate session."
      width={660}
      height={640}
    >
      <PickerBody target={target} />
    </Sheet>
  );
}

function parentOf(path: string) {
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "/";
}

function PickerBody({ target }: { target: "active" | "new" }) {
  const projectsById = useApp((s) => s.projects);
  const home = useApp((s) => s.info?.home);
  const connection = useApp((s) => s.connection);
  const recent = useMemo(() => recentProjects(projectsById).slice(0, 6), [projectsById]);

  const [listing, setListing] = useState<DirListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const show = useCallback((next: DirListing) => {
    setListing(next);
    setPathInput(next.path);
    setFilter("");
    setSelected(0);
    setError(null);
  }, []);

  const go = async (path?: string, hidden = showHidden) => {
    setBusy(true);
    try {
      show(await api.listDir(path, hidden));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Start next to the most recent project (sibling folders are the likeliest
  // pick), falling back to the home folder if that one is gone.
  const [startPath] = useState(() => (recent[0] ? parentOf(recent[0].path) : undefined));
  useEffect(() => {
    filterRef.current?.focus();
    api
      .listDir(startPath)
      .catch(() => api.listDir())
      .then(show, (e: Error) => setError(e.message));
  }, [startPath, show]);

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = listing?.entries ?? [];
    return q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
  }, [listing, filter]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const openPath = async (path: string) => {
    setBusy(true);
    try {
      await openFolder(path, target);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const currentName = listing ? listing.path.split("/").filter(Boolean).pop() ?? "/" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {recent.length > 0 && (
        <div className="border-b border-line px-5 py-3">
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Recent</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void openPath(p.path)}
                title={p.path}
                className="flex h-7 items-center gap-2 rounded-md border border-line px-2 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <ProjectAvatar name={p.name} size={15} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 px-4 pt-3">
        <IconButton label="Home folder" onClick={() => void go(home)}>
          <House size={15} />
        </IconButton>
        <IconButton label="Parent folder" onClick={() => listing?.parent && void go(listing.parent)}>
          <ArrowUp size={15} />
        </IconButton>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            void go(pathInput);
          }}
        >
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            spellCheck={false}
            aria-label="Folder path"
            placeholder="/absolute/path or ~/folder, then Enter"
            className="h-8 w-full rounded-md border border-line bg-raised px-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
          />
        </form>
      </div>

      <div className="px-4 pb-2 pt-2">
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, entries.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (listing) void openPath(listing.path);
            } else if (e.key === "Enter" && entries[selected]) {
              e.preventDefault();
              void go(entries[selected].path);
            } else if (e.key === "Backspace" && !filter && listing?.parent) {
              e.preventDefault();
              void go(listing.parent);
            }
          }}
          spellCheck={false}
          aria-label="Filter folders"
          placeholder="Filter…  ↑↓ move · Enter go in · ⌫ go up · ⌘/Ctrl+Enter open this folder"
          className="h-8 w-full rounded-md border border-transparent bg-transparent px-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-line"
        />
      </div>

      <div ref={listRef} className="scroll-thin mx-2 min-h-[220px] flex-1 overflow-y-auto border-y border-line py-1" role="listbox" aria-label="Folders">
        {error && <div className="px-3 py-3 text-[13px] text-danger">{error}</div>}
        {!error && connection === "offline" && !listing && (
          <div className="px-3 py-3 text-[13px] text-muted">The agent is offline, so folders can&apos;t be listed.</div>
        )}
        {listing && !entries.length && !error && (
          <div className="px-3 py-3 text-[13px] text-faint">{filter ? "No folders match." : "No sub-folders here."}</div>
        )}
        {entries.map((entry, i) => (
          <div
            key={entry.path}
            data-index={i}
            role="option"
            aria-selected={i === selected}
            onClick={() => void go(entry.path)}
            onDoubleClick={() => void openPath(entry.path)}
            onMouseMove={() => setSelected(i)}
            className={cx(
              "group flex cursor-default items-center gap-2.5 rounded-md px-3 py-[7px] text-[13.5px]",
              i === selected ? "bg-hover text-ink" : "text-ink/85",
            )}
          >
            {entry.git ? (
              <FolderGit2 size={15} className="shrink-0 text-accent-fg" />
            ) : (
              <Folder size={15} className="shrink-0 text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void openPath(entry.path);
              }}
              className={cx(
                "rounded px-2 py-0.5 font-mono text-[11px] text-muted hover:bg-line-strong hover:text-ink",
                i === selected ? "visible" : "invisible",
              )}
            >
              open
            </button>
            <ChevronRight size={14} className="shrink-0 text-faint" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => {
              setShowHidden(e.target.checked);
              void go(listing?.path, e.target.checked);
            }}
            className="accent-[var(--accent)]"
          />
          Show hidden
        </label>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[11.5px] text-faint" title={listing?.path}>
          {listing ? shortPath(listing.path, home) : ""}
        </span>
        <Button variant="ghost" onClick={closeDialog}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!listing || busy} onClick={() => listing && void openPath(listing.path)}>
          Open {currentName ? `“${currentName}”` : ""}
        </Button>
      </div>
    </div>
  );
}
