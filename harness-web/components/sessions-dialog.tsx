"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderOpen, GitBranch, Plus, Trash2, X } from "lucide-react";
import type { Project, Session } from "@/lib/protocol";
import {
  closeDialog,
  deleteSession,
  fetchSessions,
  newTab,
  openDialog,
  openSession,
  recentProjects,
  removeProject,
  toast,
  useApp,
} from "@/lib/store";
import { Button, ProjectAvatar, Sheet, cx, shortPath, timeAgo } from "./ui";

export function SessionsDialog({ open }: { open: boolean }) {
  return (
    <Sheet open={open} onClose={closeDialog} title="Sessions" width={720} height={600}>
      <SessionsBody />
    </Sheet>
  );
}

function SessionsBody() {
  const projectsById = useApp((s) => s.projects);
  const sessionsById = useApp((s) => s.sessions);
  const tabs = useApp((s) => s.tabs);
  const [query, setQuery] = useState("");
  const projects = useMemo(() => recentProjects(projectsById), [projectsById]);

  useEffect(() => {
    for (const p of recentProjects(useApp.getState().projects)) {
      fetchSessions(p.id).catch((e: Error) => toast(e.message));
    }
  }, []);

  const openIds = useMemo(() => new Set(tabs.map((t) => t.sessionId)), [tabs]);
  const q = query.trim().toLowerCase();
  const byProject = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of Object.values(sessionsById)) {
      if (q && !(s.title ?? "untitled").toLowerCase().includes(q)) continue;
      map.set(s.projectId, [...(map.get(s.projectId) ?? []), s]);
    }
    for (const list of map.values()) list.sort((a, b) => b.updatedAt - a.updatedAt);
    return map;
  }, [sessionsById, q]);

  const visible = q ? projects.filter((p) => byProject.has(p.id) || p.name.toLowerCase().includes(q)) : projects;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions and folders…"
          aria-label="Search sessions"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
        />
        <Button variant="ghost" onClick={() => openDialog({ kind: "folder", target: "new" })}>
          <FolderOpen size={14} /> Open folder
        </Button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!visible.length && (
          <div className="px-3 py-8 text-center text-[13px] text-faint">
            {q ? "Nothing matches." : "No folders yet. Open one to start a session."}
          </div>
        )}
        {visible.map((p) => (
          <ProjectGroup key={p.id} project={p} sessions={byProject.get(p.id) ?? []} openIds={openIds} />
        ))}
      </div>
    </div>
  );
}

function ProjectGroup({ project, sessions, openIds }: { project: Project; sessions: Session[]; openIds: Set<string | null> }) {
  const home = useApp((s) => s.info?.home);
  const [confirm, setConfirm] = useState(false);

  return (
    <section className="mb-3">
      <div className="group flex items-center gap-2.5 px-2 py-2">
        <ProjectAvatar name={project.name} size={22} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{project.name}</span>
            {project.git && (
              <span className="flex items-center gap-1 font-mono text-[10.5px] text-faint">
                <GitBranch size={11} /> {project.git.branch ?? "detached"}
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-faint">{shortPath(project.path, home)}</div>
        </div>
        {confirm ? (
          <span className="flex items-center gap-1">
            <Button variant="danger" onClick={() => void removeProject(project.id)}>
              Forget folder and its sessions
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              <X size={13} />
            </Button>
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              title="Remove from the list (files on disk are not touched)"
              aria-label={`Forget ${project.name}`}
              className="hidden h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-danger group-hover:grid"
            >
              <Trash2 size={13} />
            </button>
            <Button
              variant="ghost"
              onClick={() => {
                newTab(project.id);
                closeDialog();
              }}
            >
              <Plus size={14} /> New session
            </Button>
          </>
        )}
      </div>
      <div className="ml-[21px] border-l border-line pl-3">
        {!sessions.length && <div className="px-2 py-1.5 text-[12.5px] text-faint">No sessions yet.</div>}
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} isOpen={openIds.has(s.id)} />
        ))}
      </div>
    </section>
  );
}

function SessionRow({ session, isOpen }: { session: Session; isOpen: boolean }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSession(session.id)}
      onKeyDown={(e) => e.key === "Enter" && openSession(session.id)}
      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover"
    >
      <span
        className={cx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          session.status === "busy" ? "blink bg-accent" : isOpen ? "bg-muted" : "bg-transparent",
        )}
        title={session.status === "busy" ? "Working" : isOpen ? "Open in a tab" : undefined}
      />
      <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", session.title ? "text-ink/90" : "italic text-faint")}>
        {session.title ?? "Untitled"}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-faint">{timeAgo(session.updatedAt)}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm) void deleteSession(session.id);
          else setConfirm(true);
        }}
        aria-label={confirm ? "Confirm delete" : "Delete session"}
        className={cx(
          "h-6 shrink-0 place-items-center rounded px-1.5 font-mono text-[11px]",
          confirm ? "grid bg-danger/15 text-danger" : "hidden text-faint hover:text-danger group-hover:grid",
        )}
      >
        {confirm ? "delete?" : <Trash2 size={12} />}
      </button>
    </div>
  );
}
