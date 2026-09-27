// Pixel crab sprites, 16×10 cells. The engine scales them by a whole number
// of screen pixels per cell (2, 3 or 4), so they stay crisp.
//
// The crab is an original pixel-art sprite for DopeCode; swap this sprite
// out before shipping publicly.
//
// Cell legend: B body · L highlight · S shade (claws, legs) · K eyes
//              P laptop lid · G lid logo · Q keyboard · D paper · T text lines

export const COLS = 16;
export const ROWS = 10;

export const LAYERS = ["S", "B", "L", "K", "P", "G", "Q", "D", "T"] as const;
export type Layer = (typeof LAYERS)[number];

export const COLORS: Record<Layer, string> = {
  B: "#d97757",
  L: "#efa283",
  S: "#a3553a",
  K: "#1a1210",
  P: "#3a3c42",
  G: "#e9e7df",
  Q: "#5a5d65",
  D: "#eeeae1",
  T: "#9c978c",
};

const CROWN = ["...LLBBBBBBBB...", "...LBBBBBBBBB..."];
const EYES = {
  ahead: ["...BBKBBBBKBB...", "...BBKBBBBKBB..."],
  left: ["...BKBBBBKBBB...", "...BKBBBBKBBB..."],
  right: ["...BBBKBBBBKB...", "...BBBKBBBBKB..."],
  blink: ["...BBBBBBBBBB...", "...BBKBBBBKBB..."],
  happy: ["...BBKBBBBKBB...", "...BKBKBBKBKB..."],
};
const ARMS_OUT = [".SSBBBBBBBBBBSS.", ".SSBBBBBBBBBBSS.", "...BBBBBBBBBB...", "...SSSSSSSSSS..."];
const ARMS_TUCKED = ["...BBBBBBBBBB...", "...BBBBBBBBBB...", "...BBBBBBBBBB...", "...SSSSSSSSSS..."];
const LEGS = {
  stand: ["....S.S..S.S....", "....S.S..S.S...."],
  a: ["....S.S..S.S....", "...S.S..S.S....."],
  b: ["....S.S..S.S....", ".....S.S..S.S..."],
  dangle: ["....S.S..S.S....", "...S...SS...S..."],
};
const RAISED = [".S.LLBBBBBBBB.S.", ".SSLBBBBBBBBBSS."];

const typing = (claw: string) => [
  ...CROWN,
  "...BBBBBBBBBB...",
  "...BBKBBBBKBB...",
  "...BBKBBBBKBB...",
  "..PPPPPPPPPPPP..",
  "..PPPPPGGPPPPP..",
  "..PPPPPPPPPPPP..",
  claw,
  ...LEGS.stand.slice(1),
];

const reading = (eyes: string[]) => [
  ...CROWN,
  ...eyes,
  ".S.BBBBBBBBBB.S.",
  ".SDDDDDDDDDDDDS.",
  "..DTTTTTTTTTDD..",
  "..DDDDDDDDDDDD..",
  "..DTTTTTTDDDDD..",
  ...LEGS.stand.slice(1),
];

const SOURCES = {
  stand: [...CROWN, ...EYES.ahead, ...ARMS_OUT, ...LEGS.stand],
  lookL: [...CROWN, ...EYES.left, ...ARMS_OUT, ...LEGS.stand],
  lookR: [...CROWN, ...EYES.right, ...ARMS_OUT, ...LEGS.stand],
  blink: [...CROWN, ...EYES.blink, ...ARMS_OUT, ...LEGS.stand],
  walkA: [...CROWN, ...EYES.ahead, ...ARMS_OUT, ...LEGS.a],
  walkB: [...CROWN, ...EYES.ahead, ...ARMS_OUT, ...LEGS.b],
  think: [CROWN[0], "...LBKBBBBKBB...", "...BBKBBBBKBB...", "...BBBBBBBBBB...", ...ARMS_OUT, ...LEGS.stand],
  cheer: [...RAISED, ...EYES.ahead, ...ARMS_TUCKED, ...LEGS.dangle],
  happy: [...RAISED, ...EYES.happy, ...ARMS_TUCKED, ...LEGS.stand],
  dangle: [...RAISED, ...EYES.ahead, ...ARMS_TUCKED, ...LEGS.dangle],
  dizzy: ["...LLBBBBBBBB...", "...BKBKBBKBKB...", "...BBKBBBBKBB...", "...BKBKBBKBKB...", ...ARMS_OUT, ...LEGS.stand],
  sleep: [
    "................",
    ...CROWN,
    "...BBBBBBBBBB...",
    "...BKKBBBBKKB...",
    ".SSBBBBBBBBBBSS.",
    ".SSBBBBBBBBBBSS.",
    "...BBBBBBBBBB...",
    "...SSSSSSSSSS...",
    "..SSSSSSSSSSSS..",
  ],
  typeA: typing(".SQQQQQQQQQQQQ.."),
  typeB: typing("..QQQQQQQQQQQQS."),
  readA: reading(EYES.left),
  readB: reading(EYES.right),
} satisfies Record<string, string[]>;

export type FrameName = keyof typeof SOURCES;
export type Frame = Record<Layer, string>;

function compile(rows: string[]): Frame {
  if (rows.length !== ROWS || rows.some((r) => r.length !== COLS)) throw new Error("Bad crab frame");
  const out = Object.fromEntries(LAYERS.map((l) => [l, ""])) as Frame;
  rows.forEach((row, y) => {
    for (let x = 0; x < COLS; x++) {
      const c = row[x] as Layer | ".";
      if (c !== ".") out[c] += `M${x} ${y}h1v1h-1z`;
    }
  });
  return out;
}

export const FRAMES = Object.fromEntries(
  Object.entries(SOURCES).map(([name, rows]) => [name, compile(rows)]),
) as Record<FrameName, Frame>;

/** SVG markup for a still crab (used to generate the app icon). */
export function spriteMarkup(frame: FrameName) {
  const f = FRAMES[frame];
  return LAYERS.map((l) => (f[l] ? `<path d="${f[l]}" fill="${COLORS[l]}"/>` : "")).join("");
}
