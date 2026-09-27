"use client";

import { useReducedMotion } from "motion/react";
import type { Connection } from "@/lib/store";

// Pixel glyphs, 4 columns × 9 rows: rows 0–1 ascender, 2–6 x-height, 7–8
// descender. "X" is ink; blank x-height cells get a dimmer "counter" fill.
const GLYPHS: Record<string, string[]> = {
  d: ["...X", "...X", "XXXX", "X..X", "X..X", "X..X", "XXXX", "....", "...."],
  o: ["....", "....", "XXXX", "X..X", "X..X", "X..X", "XXXX", "....", "...."],
  p: ["....", "....", "XXXX", "X..X", "X..X", "X..X", "XXXX", "X...", "X..."],
  e: ["....", "....", "XXXX", "X..X", "XXXX", "X...", "XXXX", "....", "...."],
  c: ["....", "....", "XXXX", "X...", "X...", "X...", "XXXX", "....", "...."],
};

const WORD = "dopecode";
const HOT = 4; // "dope" is lit, "code" is graphite
const GAP = 1;
const CURSOR_W = 2;
const ROWS = 9;
const WIDTH = WORD.length * 4 + (WORD.length - 1) * GAP + GAP + CURSOR_W;

// One path per letter and fill, so abutting cells rasterize as one shape.
const letters = WORD.split("").map((ch, i) => {
  const x0 = i * (4 + GAP);
  let ink = "";
  let counter = "";
  GLYPHS[ch].forEach((row, y) =>
    row.split("").forEach((c, dx) => {
      const cell = `M${x0 + dx} ${y}h1v1h-1z`;
      if (c === "X") ink += cell;
      else if (y >= 2 && y <= 6) counter += cell;
    }),
  );
  return { i, ink, counter, hot: i < HOT };
});

const CURSOR_FILL: Record<Connection, string> = {
  online: "var(--accent)",
  connecting: "var(--faint)",
  offline: "var(--danger)",
};

export function Wordmark({ connection, className }: { connection: Connection; className?: string }) {
  const still = useReducedMotion();
  return (
    <div className={`relative ${className ?? ""}`}>
      <svg viewBox={`0 0 ${WIDTH} ${ROWS}`} className="block w-full overflow-visible" role="img" aria-label="DopeCode">
        <defs>
          <linearGradient id="dope-shine" gradientUnits="userSpaceOnUse" x1="-14" y1="0" x2="-6" y2="9">
            <stop offset="0" style={{ stopColor: "var(--wm-hot)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--wm-shine)" }} />
            <stop offset="1" style={{ stopColor: "var(--wm-hot)" }} />
            {!still && (
              <>
                <animate attributeName="x1" values="-14;-14;22" keyTimes="0;0.6;1" dur="5s" repeatCount="indefinite" />
                <animate attributeName="x2" values="-6;-6;30" keyTimes="0;0.6;1" dur="5s" repeatCount="indefinite" />
              </>
            )}
          </linearGradient>
        </defs>
        {letters.map((l) => (
          <g key={l.i} className="wm-drop" style={{ animationDelay: `${120 + l.i * 65}ms` }}>
            <path d={l.counter} style={{ fill: l.hot ? "var(--wm-hot-counter)" : "var(--wm-counter)" }} />
            <path d={l.ink} style={{ fill: l.hot ? "url(#dope-shine)" : "var(--wm-ink)" }} />
          </g>
        ))}
        <rect
          className={connection === "online" ? "blink" : undefined}
          x={WIDTH - CURSOR_W}
          y={2}
          width={CURSOR_W}
          height={5}
          style={{ fill: CURSOR_FILL[connection] }}
        />
      </svg>
      {/* The x-height line, from the "o" on: dopelings walk along the letter tops. */}
      <div
        data-perch="wordmark"
        className="absolute h-0"
        style={{ top: `${(2 / ROWS) * 100}%`, left: `${(5 / WIDTH) * 100}%`, right: 0 }}
      />
    </div>
  );
}
