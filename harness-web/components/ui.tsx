"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function shortPath(path: string, home: string | undefined) {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

export function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** "⌥T" on macOS, "Alt+T" elsewhere. */
export function altKey(key: string) {
  return isMac() ? `⌥${key}` : `Alt+${key}`;
}

/** Three pixels hopping: the "working" indicator. */
export function PixelLoader({ className }: { className?: string }) {
  return (
    <span className={cx("pixel-loader", className)} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function ProjectAvatar({ name, busy, size = 18 }: { name?: string | null; busy?: boolean; size?: number }) {
  const letter = (name ?? "?").replace(/^[^a-z0-9]+/i, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center rounded-[4px] bg-line-strong font-mono text-ink"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
      aria-hidden
    >
      {letter}
      {busy && (
        <span className="blink absolute -right-[3px] -top-[3px] h-[7px] w-[7px] rounded-[2px] bg-accent ring-2 ring-bg" />
      )}
    </span>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Closes on outside click or Escape. Attach the returned ref to the menu's wrapper. */
export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  return ref;
}

/** Modal built on the native <dialog>: focus trap, Escape and top layer for free. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width,
  height,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  width?: number;
  /** Fixed height, for sheets whose content changes size (keeps them from jumping). */
  height?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      style={{
        ...(width && { width: `min(${width}px, calc(100vw - 32px))` }),
        ...(height && { height: `min(${height}px, calc(100dvh - 48px))` }),
      }}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      {open && (
        <>
          <div className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-pixel text-[13px] uppercase tracking-[0.08em] text-ink">{title}</h2>
              {subtitle && <div className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{subtitle}</div>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
              <X size={16} />
            </IconButton>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  type = "button",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110 active:scale-95",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-ink",
        variant === "danger" && "text-danger hover:bg-danger/10",
        className,
      )}
    >
      {children}
    </button>
  );
}
