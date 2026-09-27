// Real (read-only) filesystem access for the folder picker. Only folder names
// are listed; no file contents are read except .git/HEAD for the branch name.

import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { DirEntry, DirListing, GitInfo } from "../lib/protocol";

export class FsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function resolveUserPath(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw || raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  if (!isAbsolute(raw)) throw new FsError("Use an absolute path (or one starting with ~/).", 400);
  return resolve(raw);
}

function fsError(err: unknown, path: string): FsError {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return new FsError(`No such folder: ${path}`, 404);
  if (code === "ENOTDIR") return new FsError(`Not a folder: ${path}`, 400);
  if (code === "EACCES" || code === "EPERM") return new FsError(`Permission denied: ${path}`, 403);
  return new FsError(`Can't read ${path}`, 500);
}

async function isDir(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function assertDir(path: string) {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) throw new FsError(`Not a folder: ${path}`, 400);
  } catch (err) {
    if (err instanceof FsError) throw err;
    throw fsError(err, path);
  }
}

export async function listDir(path: string, showHidden: boolean): Promise<DirListing> {
  let dirents;
  try {
    dirents = await readdir(path, { withFileTypes: true });
  } catch (err) {
    throw fsError(err, path);
  }
  const candidates = dirents.filter((d) => (showHidden || !d.name.startsWith(".")) && (d.isDirectory() || d.isSymbolicLink()));
  const entries = (
    await Promise.all(
      candidates.map(async (d): Promise<DirEntry | null> => {
        const full = join(path, d.name);
        if (d.isSymbolicLink() && !(await isDir(full))) return null;
        return { name: d.name, path: full, git: await exists(join(full, ".git")) };
      }),
    )
  )
    .filter((e): e is DirEntry => e !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, entries };
}

/** Finds the enclosing repository and reads its current branch. */
export async function gitInfo(path: string): Promise<GitInfo | null> {
  let dir = path;
  for (;;) {
    const dotGit = join(dir, ".git");
    const s = await stat(dotGit).catch(() => null);
    if (s) return readBranch(dir, dotGit, s.isFile());
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function readBranch(repoDir: string, dotGit: string, isPointerFile: boolean): Promise<GitInfo> {
  try {
    let gitDir = dotGit;
    if (isPointerFile) {
      // Worktrees and submodules: ".git" is a file pointing at the real git dir.
      const pointer = (await readFile(dotGit, "utf8")).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
      if (!pointer) return { branch: null };
      gitDir = resolve(repoDir, pointer);
    }
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
    return { branch: head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1] ?? null };
  } catch {
    return { branch: null };
  }
}

/** Top-level entries of a folder, for the mock "list" tool. */
export async function topLevel(path: string, limit = 40) {
  const dirents = await readdir(path, { withFileTypes: true });
  const names = dirents
    .filter((d) => !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  return { total: names.length, shown: names.slice(0, limit) };
}
