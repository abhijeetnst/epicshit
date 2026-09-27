// The crab layer: one pixel crab per open tab, living on the edges of the
// screen like a desktop pet, and acting out what its session is doing (after
// Pixel Agents and the Clawd desktop pets). Idle crabs roam: they walk the
// floor, climb the side walls, cross the ceiling and drop back down. When a
// session starts working, its crab scuttles to its desk spot on the floor and
// types or reads there under a status bubble. Finished turns get a little
// hop; errors leave it dizzy; long idle or an offline agent puts it to sleep.
//
// Click a crab to open its tab; drag to pick it up and fling it. The overlay
// is pointer-events: none and input is hit-tested here, so a crab standing on
// a button never blocks it.
//
// Plain DOM nodes moved in a requestAnimationFrame loop: React never renders per frame.

import { COLORS, COLS, FRAMES, LAYERS, ROWS, type FrameName, type Layer } from "./sprites";

export type Job = "idle" | "think" | "type" | "read" | "error" | "offline";

export interface CrabAgent {
  /** The tab this crab stands for. */
  id: string;
  index: number;
  title: string;
  folder: string | null;
  job: Job;
  /** Short status for the bubble and card, e.g. "writing", "list". */
  detail: string;
  active: boolean;
  /** Status of the session's last message, used to react when a turn ends. */
  lastStatus: "done" | "error" | "aborted" | "streaming" | null;
}

interface Callbacks {
  onOpen: (id: string) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const GRAVITY = 1500;
const MAX_FALL = 1100;
const DOZE_AFTER = 120; // seconds idle before a crab naps

type Wall = "floor" | "ceiling" | "left" | "right";
type Surface = { kind: "wall"; wall: Wall } | { kind: "perch"; id: string };
type Mode = "roam" | "rest" | "fall" | "drag" | "land" | "commute" | "work" | "sleep";

interface Crab {
  agent: CrabAgent;
  el: HTMLDivElement;
  paths: Record<Layer, SVGPathElement>;
  tag: HTMLSpanElement;
  bubble: HTMLDivElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: 1 | -1;
  surface: Surface | null;
  mode: Mode;
  timer: number;
  clock: number;
  frame: FrameName | null;
  speed: number;
  spin: number;
  /** Seconds since the job last changed, for dozing off. */
  jobAge: number;
  /** A short reaction after a turn: "done" hop or "stopped" shrug. */
  reaction: { kind: "done" | "stopped"; t: number } | null;
  /** False until the crab has dropped in. */
  spawned: boolean;
  leaving: boolean;
  bubbleText: string;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const WORKING = new Set<Job>(["think", "type", "read"]);

export class CrabEngine {
  /** Screen pixels per sprite cell; the crab is COLS×ROWS cells. */
  private cell = 3;
  private W = COLS * 3;
  private H = ROWS * 3;
  /** A crab on a side wall is rotated a quarter turn, so its box sticks out this much. */
  private inset = (this.W - this.H) / 2;
  private crabs = new Map<string, Crab>();
  private perches = new Map<string, DOMRect>();
  private w = window.innerWidth;
  private h = window.innerHeight;
  private raf = 0;
  private last = 0;
  private perchClock = 0;
  private pointer = { x: -1, y: -1 };
  private drag: {
    crab: Crab;
    offX: number;
    offY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null = null;
  private hovered: Crab | null = null;
  private card: HTMLDivElement;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private root: HTMLElement,
    private cb: Callbacks,
    cell = 3,
  ) {
    this.applyScale(cell);
    this.card = document.createElement("div");
    this.card.className = "crab-card";
    root.appendChild(this.card);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("pointermove", this.onPointerMove, true);
    window.addEventListener("pointerup", this.onPointerUp, true);
    window.addEventListener("pointercancel", this.onPointerUp, true);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const t of this.timers) clearTimeout(t);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerup", this.onPointerUp, true);
    window.removeEventListener("pointercancel", this.onPointerUp, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.documentElement.classList.remove("crab-hover", "crab-grabbing");
    this.root.replaceChildren();
    this.crabs.clear();
  }

  /** Resizes every crab: `cell` screen pixels per sprite pixel. */
  setScale(cell: number) {
    if (cell === this.cell) return;
    this.applyScale(cell);
    for (const c of this.crabs.values()) {
      this.sizeElement(c.el);
      this.stick(c);
      this.draw(c);
    }
    this.perchClock = 0;
  }

  private applyScale(cell: number) {
    this.cell = cell;
    this.W = COLS * cell;
    this.H = ROWS * cell;
    this.inset = (this.W - this.H) / 2;
  }

  private sizeElement(el: HTMLElement) {
    el.style.width = `${this.W}px`;
    el.style.height = `${this.H}px`;
    const svg = el.querySelector("svg")!;
    svg.setAttribute("width", String(this.W));
    svg.setAttribute("height", String(this.H));
  }

  /** Walking speeds are tuned for 2px cells; bigger crabs take bigger steps. */
  private get pace() {
    return this.cell / 2;
  }

  /** Reconciles crabs with the open tabs and their sessions' state. */
  sync(agents: CrabAgent[]) {
    const seen = new Set<string>();
    let arrivals = 0;
    for (const agent of agents) {
      seen.add(agent.id);
      const crab = this.crabs.get(agent.id);
      if (!crab) {
        const fresh = this.create(agent);
        this.crabs.set(agent.id, fresh);
        // New tab: drop in from the top, staggered if several appear at once.
        this.later(arrivals++ * 160, () => this.dropIn(fresh));
        continue;
      }
      const prev = crab.agent;
      crab.agent = agent;
      if (prev.job !== agent.job) {
        crab.jobAge = 0;
        if (WORKING.has(prev.job) && !WORKING.has(agent.job)) this.finished(crab);
        if (WORKING.has(agent.job)) this.goToWork(crab);
        if (agent.job === "idle" && crab.mode === "sleep") this.wake(crab);
      }
      crab.tag.textContent = agent.index < 9 ? String(agent.index + 1) : "";
      crab.el.classList.toggle("crab-active", agent.active);
      if (this.hovered === crab) this.showCard(crab);
    }
    for (const [id, crab] of this.crabs) if (!seen.has(id) && !crab.leaving) this.dismiss(crab);
    this.run();
  }

  // ---- Lifecycle -----------------------------------------------------------------

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private run() {
    if (this.raf || !this.crabs.size || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private create(agent: CrabAgent): Crab {
    const el = document.createElement("div");
    el.className = agent.active ? "crab crab-active" : "crab";
    el.style.opacity = "0";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 10");
    svg.setAttribute("shape-rendering", "crispEdges");
    const paths = {} as Record<Layer, SVGPathElement>;
    for (const layer of LAYERS) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("fill", COLORS[layer]);
      svg.appendChild(p);
      paths[layer] = p;
    }
    const tag = document.createElement("span");
    tag.className = "crab-tag";
    tag.textContent = agent.index < 9 ? String(agent.index + 1) : "";
    el.append(svg, tag);
    this.sizeElement(el);

    const bubble = document.createElement("div");
    bubble.className = "crab-bubble";
    this.root.append(el, bubble);
    return {
      agent,
      el,
      paths,
      tag,
      bubble,
      x: rand(24, Math.max(24, this.w - this.W - 24)),
      y: -this.H - 40,
      vx: 0,
      vy: 0,
      dir: Math.random() < 0.5 ? 1 : -1,
      surface: null,
      mode: "fall",
      timer: 0,
      clock: rand(0, 4),
      frame: null,
      speed: rand(30, 46),
      spin: 0,
      jobAge: 0,
      reaction: null,
      spawned: false,
      leaving: false,
      bubbleText: "",
    };
  }

  private dropIn(c: Crab) {
    if (c.leaving) return;
    // Busy sessions land at their desk; idle ones anywhere.
    c.x = WORKING.has(c.agent.job) ? this.deskX(c) : rand(24, Math.max(24, this.w - this.W - 24));
    c.y = -this.H - rand(10, 60);
    c.vx = 0;
    c.vy = 0;
    c.surface = null;
    c.mode = "fall";
    c.spawned = true;
    this.draw(c);
    c.el.style.opacity = "1";
  }

  private dismiss(c: Crab) {
    c.leaving = true;
    c.el.style.opacity = "0";
    c.bubble.classList.remove("show");
    this.later(320, () => {
      c.el.remove();
      c.bubble.remove();
      if (this.crabs.get(c.agent.id) === c) this.crabs.delete(c.agent.id);
      if (this.hovered === c) this.hideCard();
    });
  }

  // ---- Reacting to the session ----------------------------------------------------

  /** Desk spots line the floor from the right edge, one per tab. */
  private deskX(c: Crab) {
    const slot = c.agent.index;
    const perRow = Math.max(1, Math.floor((this.w - 96) / (this.W + 36)));
    const gap = this.W + 36;
    return clamp(this.w - this.W - 40 - (slot % perRow) * gap, 8, this.w - this.W - 8);
  }

  private goToWork(c: Crab) {
    if (c.mode === "drag" || c.mode === "fall" || c.leaving) return;
    const s = c.surface;
    if (s?.kind === "wall" && s.wall !== "floor") return this.letGo(c);
    if (s?.kind === "perch") {
      c.mode = "work"; // a perch is as good a desk as any
      return;
    }
    c.mode = "commute";
  }

  private finished(c: Crab) {
    const status = c.agent.lastStatus;
    if (status === "done") {
      c.reaction = { kind: "done", t: 2.6 };
      if (this.grounded(c) && c.mode !== "drag") this.hop(c, 330);
    } else if (status === "aborted") {
      c.reaction = { kind: "stopped", t: 1.8 };
    }
    if (c.mode === "work" || c.mode === "commute") {
      c.mode = "rest";
      c.timer = rand(0.8, 1.6);
    }
  }

  private wake(c: Crab) {
    c.mode = "rest";
    c.timer = rand(0.4, 1);
    c.jobAge = 0;
  }

  // ---- Simulation --------------------------------------------------------------------

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.crabs.size) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.perchClock -= dt;
    if (this.perchClock <= 0) {
      this.readPerches();
      this.perchClock = 0.25;
    }
    this.spread(dt);
    for (const c of this.crabs.values()) {
      this.step(c, dt);
      this.draw(c);
    }
    if (this.hovered) this.placeCard(this.hovered);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Resting crabs that share a surface shuffle apart instead of stacking up. */
  private spread(dt: number) {
    const still = [...this.crabs.values()].filter(
      (c) => c.spawned && !c.leaving && (c.mode === "rest" || c.mode === "work" || c.mode === "sleep") && this.grounded(c),
    );
    for (let i = 0; i < still.length; i++) {
      for (let j = i + 1; j < still.length; j++) {
        const a = still[i];
        const b = still[j];
        if (JSON.stringify(a.surface) !== JSON.stringify(b.surface)) continue;
        const dx = b.x - a.x;
        if (Math.abs(dx) >= this.W + 6) continue;
        const push = (dx >= 0 ? 1 : -1) * 40 * dt;
        // Working crabs hold their desk; the other one moves.
        if (a.mode !== "work") a.x -= push;
        if (b.mode !== "work") b.x += push;
      }
    }
  }

  private readPerches() {
    this.perches.clear();
    for (const el of document.querySelectorAll<HTMLElement>("[data-perch]")) {
      const r = el.getBoundingClientRect();
      if (r.width > this.W * 2 && r.top > this.H + 40 && r.top < this.h - this.H) this.perches.set(el.dataset.perch!, r);
    }
  }

  private grounded(c: Crab) {
    const s = c.surface;
    return !!s && (s.kind === "perch" || s.wall === "floor");
  }

  private step(c: Crab, dt: number) {
    if (!c.spawned) return;
    c.clock += dt;
    c.jobAge += dt;
    if (c.reaction && (c.reaction.t -= dt) <= 0) c.reaction = null;
    const job = c.agent.job;

    switch (c.mode) {
      case "drag":
        return;
      case "fall": {
        const prevY = c.y;
        c.vy = Math.min(c.vy + GRAVITY * dt, MAX_FALL);
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.spin += c.vx * dt * 0.9;
        if (c.x < 0) {
          c.x = 0;
          c.vx = Math.abs(c.vx) * 0.45;
        } else if (c.x > this.w - this.W) {
          c.x = this.w - this.W;
          c.vx = -Math.abs(c.vx) * 0.45;
        }
        if (c.y < 0 && c.vy < 0) {
          c.y = 0;
          c.vy = Math.abs(c.vy) * 0.3;
        }
        if (c.vy >= 0) this.checkLanding(c, prevY);
        return;
      }
      case "land":
        this.stick(c);
        if ((c.timer -= dt) <= 0) this.settle(c);
        return;
      case "sleep":
        this.stick(c);
        if ((c.timer -= dt) <= 0) {
          this.fx(c, "z");
          c.timer = rand(1.6, 2.8);
        }
        if (job !== "offline" && job !== "idle") this.goToWork(c);
        return;
      case "work":
        this.stick(c);
        if (!WORKING.has(job) && job !== "offline") {
          c.mode = "rest";
          c.timer = 1;
        } else if (job === "offline") this.nap(c);
        return;
      case "commute": {
        this.stick(c);
        if (!this.grounded(c)) return this.letGo(c);
        if (c.surface?.kind === "perch") {
          c.mode = "work";
          return;
        }
        const target = this.deskX(c);
        const dx = target - c.x;
        const step = 120 * this.pace * dt;
        if (Math.abs(dx) <= step) {
          c.x = target;
          c.mode = job === "offline" ? "sleep" : "work";
          c.timer = 0;
        } else {
          c.dir = dx > 0 ? 1 : -1;
          c.x += c.dir * step;
        }
        return;
      }
      case "rest":
        this.stick(c);
        if (job === "offline") return this.nap(c);
        if (WORKING.has(job)) return this.goToWork(c);
        if (job === "idle" && c.jobAge > DOZE_AFTER && this.grounded(c)) return this.nap(c);
        if ((c.timer -= dt) <= 0) this.roam(c);
        return;
      case "roam":
        if (job === "offline") return this.grounded(c) ? this.nap(c) : this.letGo(c);
        if (WORKING.has(job)) return this.goToWork(c);
        this.stepRoam(c, dt);
        return;
    }
  }

  private checkLanding(c: Crab, prevY: number) {
    const bottom = c.y + this.H;
    const prevBottom = prevY + this.H;
    const cx = c.x + this.W / 2;
    for (const [id, r] of this.perches) {
      if (prevBottom <= r.top + 2 && bottom >= r.top && cx > r.left + 8 && cx < r.right - 8) {
        c.y = r.top - this.H;
        return this.touchDown(c, { kind: "perch", id });
      }
    }
    if (bottom >= this.h) {
      c.y = this.h - this.H;
      this.touchDown(c, { kind: "wall", wall: "floor" });
    }
  }

  private touchDown(c: Crab, surface: Surface) {
    if (c.vy > 560) {
      // Thrown hard: bounce, and come up the right way round.
      c.vy = -c.vy * 0.3;
      c.vx *= 0.6;
      c.y -= 1;
      c.spin = Math.round(c.spin / 360) * 360;
      return;
    }
    c.surface = surface;
    c.mode = "land";
    c.timer = 0.16;
    c.vx = 0;
    c.vy = 0;
    c.spin = 0;
  }

  private settle(c: Crab) {
    const job = c.agent.job;
    if (job === "offline") return this.nap(c);
    if (WORKING.has(job)) return this.goToWork(c);
    c.mode = "rest";
    c.timer = rand(0.4, 1.4);
  }

  /** Keeps a resting crab on its surface when that moves (prompt box grew, window resized). */
  private stick(c: Crab) {
    const s = c.surface;
    if (!s) return;
    if (s.kind === "perch") {
      const r = this.perches.get(s.id);
      if (!r) return this.fallOff(c, 0);
      c.y = r.top - this.H;
      c.x = clamp(c.x, r.left, r.right - this.W);
    } else if (s.wall === "floor") {
      c.y = this.h - this.H;
      c.x = clamp(c.x, 0, this.w - this.W);
    } else if (s.wall === "right") c.x = this.w - this.W + this.inset;
    else if (s.wall === "left") c.x = -this.inset;
  }

  private roam(c: Crab) {
    c.mode = "roam";
    c.timer = rand(2.5, 6);
    if (this.grounded(c) && Math.random() < 0.4) c.dir = c.dir === 1 ? -1 : 1;
  }

  private stepRoam(c: Crab, dt: number) {
    const s = c.surface;
    if (!s) return this.fallOff(c, 0);
    const d = c.speed * this.pace * dt;
    c.timer -= dt;
    const yMin = this.inset;
    const yMax = this.h - this.H - this.inset;

    if (s.kind === "perch") {
      const r = this.perches.get(s.id);
      if (!r) return this.fallOff(c, 0);
      c.y = r.top - this.H;
      c.x += c.dir * d;
      if (c.x < r.left || c.x > r.right - this.W) {
        if (Math.random() < 0.5) return this.fallOff(c, c.dir * 60);
        c.x = clamp(c.x, r.left, r.right - this.W);
        c.dir = c.dir === 1 ? -1 : 1;
      }
    } else if (s.wall === "floor") {
      c.y = this.h - this.H;
      c.x += c.dir * d;
      if (c.x <= 0) {
        c.x = 0;
        if (Math.random() < 0.5) this.onto(c, "left", -1, -this.inset, yMax);
        else c.dir = 1;
      } else if (c.x >= this.w - this.W) {
        c.x = this.w - this.W;
        if (Math.random() < 0.5) this.onto(c, "right", -1, this.w - this.W + this.inset, yMax);
        else c.dir = -1;
      }
    } else if (s.wall === "left" || s.wall === "right") {
      c.y += c.dir * d * 0.85;
      if (c.y <= yMin) {
        if (Math.random() < 0.6) this.onto(c, "ceiling", s.wall === "left" ? 1 : -1, s.wall === "left" ? 0 : this.w - this.W, 0);
        else {
          c.y = yMin;
          c.dir = 1;
        }
      } else if (c.y >= yMax) {
        this.onto(c, "floor", s.wall === "left" ? 1 : -1, s.wall === "left" ? 0 : this.w - this.W, this.h - this.H);
      }
    } else {
      c.y = 0;
      c.x += c.dir * d;
      if (c.x <= 0) this.onto(c, "left", 1, -this.inset, yMin);
      else if (c.x >= this.w - this.W) this.onto(c, "right", 1, this.w - this.W + this.inset, yMin);
    }

    if (c.timer <= 0 && c.mode === "roam") this.decide(c);
  }

  private onto(c: Crab, wall: Wall, dir: 1 | -1, x: number, y: number) {
    c.surface = { kind: "wall", wall };
    c.dir = dir;
    c.x = x;
    c.y = y;
  }

  private decide(c: Crab) {
    c.timer = rand(2.5, 6);
    const s = c.surface!;
    const r = Math.random();
    if (s.kind === "wall" && s.wall === "ceiling") {
      if (r < 0.4) this.letGo(c);
      return;
    }
    if (s.kind === "wall" && s.wall !== "floor") {
      if (r < 0.15) this.letGo(c);
      else if (r < 0.4) c.dir = c.dir === 1 ? -1 : 1;
      return;
    }
    if (r < 0.35) {
      c.mode = "rest";
      c.timer = rand(1.2, 4);
    } else if (r < 0.5) c.dir = c.dir === 1 ? -1 : 1;
  }

  private letGo(c: Crab) {
    const wall = c.surface?.kind === "wall" ? c.surface.wall : null;
    if (wall === "left") c.x = 0;
    if (wall === "right") c.x = this.w - this.W;
    c.surface = null;
    c.mode = "fall";
    c.vx = wall === "left" ? 80 : wall === "right" ? -80 : rand(-30, 30);
    c.vy = 0;
  }

  private hop(c: Crab, power: number) {
    c.surface = null;
    c.mode = "fall";
    c.vy = -power;
    c.vx = 0;
  }

  private fallOff(c: Crab, vx: number) {
    c.surface = null;
    c.mode = "fall";
    c.vx = vx;
    c.vy = -30;
  }

  private nap(c: Crab) {
    c.mode = "sleep";
    c.timer = rand(0.4, 1.8);
  }

  // ---- Drawing --------------------------------------------------------------------------

  private frameFor(c: Crab): FrameName {
    const fast = Math.floor(c.clock * 7) % 2 === 0;
    switch (c.mode) {
      case "fall":
        return c.vy < 0 && c.reaction?.kind === "done" ? "happy" : "cheer";
      case "drag":
        return "dangle";
      case "sleep":
        return "sleep";
      case "commute":
      case "roam":
        return fast ? "walkA" : "walkB";
      case "work":
        if (c.agent.job === "read") return Math.floor(c.clock * 1.6) % 2 ? "readA" : "readB";
        if (c.agent.job === "think") return "think";
        return Math.floor(c.clock * 9) % 2 ? "typeA" : "typeB";
      default: {
        if (c.reaction?.kind === "done") return "happy";
        if (c.agent.job === "error" && c.jobAge < 8) return "dizzy";
        if (c.clock % 4.2 < 0.14) return "blink";
        // Idle eyes follow the cursor.
        const dx = this.pointer.x - (c.x + this.W / 2);
        if (this.pointer.x < 0 || (c.surface?.kind === "wall" && c.surface.wall !== "floor")) return "stand";
        return dx < -60 ? "lookL" : dx > 60 ? "lookR" : "stand";
      }
    }
  }

  private draw(c: Crab) {
    const frame = this.frameFor(c);
    if (frame !== c.frame) {
      const f = FRAMES[frame];
      for (const layer of LAYERS) c.paths[layer].setAttribute("d", f[layer]);
      c.frame = frame;
    }

    let rot = 0;
    let sx = 1;
    let sy = 1;
    let dy = 0;
    const s = c.surface;
    const onSurface = c.mode !== "fall" && c.mode !== "drag";
    if (onSurface && s?.kind === "wall") rot = s.wall === "left" ? 90 : s.wall === "right" ? -90 : s.wall === "ceiling" ? 180 : 0;
    if (c.mode === "fall") rot = c.spin;
    if (c.mode === "drag") rot = clamp((this.drag?.vx ?? 0) * 0.025, -24, 24);
    if (c.mode === "land") {
      sx = 1.18;
      sy = 0.78;
      dy = this.H * 0.11;
    }
    if ((c.mode === "roam" || c.mode === "commute") && c.frame === "walkA") dy -= 1;

    c.el.style.transform = `translate3d(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px,0) rotate(${rot.toFixed(1)}deg) translateY(${dy}px) scale(${sx},${sy})`;
    this.drawBubble(c);
  }

  private bubbleFor(c: Crab): { text: string; tone: string } | null {
    if (c.leaving || c.mode === "drag") return null;
    if (c.reaction?.kind === "done") return { text: "✓ done", tone: "ok" };
    if (c.reaction?.kind === "stopped") return { text: "stopped", tone: "muted" };
    const job = c.agent.job;
    if (job === "error" && c.jobAge < 8) return { text: "! error", tone: "danger" };
    if (c.mode === "work" || c.mode === "commute") {
      if (job === "think") return { text: "thinking", tone: "busy" };
      return { text: c.agent.detail, tone: "busy" };
    }
    return null;
  }

  private drawBubble(c: Crab) {
    const b = this.bubbleFor(c);
    if (!b) {
      if (c.bubbleText) {
        c.bubble.classList.remove("show");
        c.bubbleText = "";
      }
      return;
    }
    const key = `${b.tone}:${b.text}`;
    if (key !== c.bubbleText) {
      c.bubble.textContent = b.text;
      c.bubble.dataset.tone = b.tone;
      c.bubble.classList.add("show");
      c.bubbleText = key;
    }
    c.bubble.style.transform = `translate3d(${(c.x + this.W / 2).toFixed(1)}px,${(c.y - 6).toFixed(1)}px,0) translate(-50%,-100%)`;
  }

  private fx(c: Crab, text: string) {
    if (this.root.childElementCount > this.crabs.size * 2 + 30) return;
    const el = document.createElement("span");
    el.className = "crab-fx";
    el.textContent = text;
    el.style.left = `${c.x + this.W * 0.7}px`;
    el.style.top = `${c.y}px`;
    el.addEventListener("animationend", () => el.remove());
    this.root.appendChild(el);
  }

  // ---- Hover card ---------------------------------------------------------------------

  private showCard(c: Crab) {
    const a = c.agent;
    const status =
      a.job === "idle" ? (c.mode === "sleep" ? "napping" : "idle") : a.job === "offline" ? "agent offline" : a.job === "think" ? "thinking" : a.detail;
    this.card.replaceChildren();
    const title = document.createElement("div");
    title.className = "crab-card-title";
    title.textContent = `${a.index < 9 ? `${a.index + 1} · ` : ""}${a.title}`;
    const meta = document.createElement("div");
    meta.className = "crab-card-meta";
    meta.textContent = [a.folder, status].filter(Boolean).join(" · ");
    const hint = document.createElement("div");
    hint.className = "crab-card-hint";
    hint.textContent = a.active ? "this tab · drag to move" : "click to open · drag to move";
    this.card.append(title, meta, hint);
    this.card.dataset.busy = String(WORKING.has(a.job));
    this.card.classList.add("show");
    this.placeCard(c);
  }

  private placeCard(c: Crab) {
    const cw = this.card.offsetWidth || 200;
    const ch = this.card.offsetHeight || 60;
    let x = c.x + this.W / 2 - cw / 2;
    let y = c.y - ch - 34;
    if (y < 8) y = c.y + this.H + 14;
    x = clamp(x, 8, this.w - cw - 8);
    y = clamp(y, 8, this.h - ch - 8);
    this.card.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`;
  }

  private hideCard() {
    this.card.classList.remove("show");
    this.hovered = null;
    document.documentElement.classList.remove("crab-hover");
  }

  // ---- Input ------------------------------------------------------------------------------

  private hit(x: number, y: number) {
    let found: Crab | null = null;
    for (const c of this.crabs.values()) {
      if (c.leaving || !c.spawned) continue;
      const onWall = c.mode !== "fall" && c.mode !== "drag" && c.surface?.kind === "wall" && (c.surface.wall === "left" || c.surface.wall === "right");
      const cx = c.x + this.W / 2;
      const cy = c.y + this.H / 2;
      const hw = (onWall ? this.H : this.W) / 2 + 3;
      const hh = (onWall ? this.W : this.H) / 2 + 3;
      if (Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh) found = c;
    }
    return found;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const c = this.hit(e.clientX, e.clientY);
    if (!c) return;
    this.drag = {
      crab: c,
      offX: e.clientX - c.x,
      offY: e.clientY - c.y,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    };
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
    const d = this.drag;
    if (d) {
      const c = d.crab;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) {
        d.moved = true;
        c.mode = "drag";
        c.surface = null;
        this.hideCard();
        document.documentElement.classList.add("crab-grabbing");
        window.getSelection()?.removeAllRanges();
      }
      if (d.moved) {
        const now = performance.now();
        const dt = Math.max(8, now - d.lastT) / 1000;
        d.vx = d.vx * 0.5 + ((e.clientX - d.lastX) / dt) * 0.5;
        d.vy = d.vy * 0.5 + ((e.clientY - d.lastY) / dt) * 0.5;
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        d.lastT = now;
        c.x = clamp(e.clientX - d.offX, 0, this.w - this.W);
        c.y = clamp(e.clientY - d.offY, 0, this.h - this.H);
        this.draw(c);
      }
      return;
    }
    const c = this.hit(e.clientX, e.clientY);
    if (c !== this.hovered) {
      if (c) {
        this.hovered = c;
        document.documentElement.classList.add("crab-hover");
        this.showCard(c);
      } else this.hideCard();
    }
    if (c && c.mode === "roam") {
      // Stops to look at you.
      c.mode = "rest";
      c.timer = 1.5;
    }
  };

  private onPointerUp = () => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const c = d.crab;
    document.documentElement.classList.remove("crab-grabbing");
    // The press was meant for the crab: swallow the click so whatever is
    // underneath (a button, a tab) doesn't fire too.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    if (d.moved) {
      c.mode = "fall";
      c.vx = clamp(d.vx, -1600, 1600);
      c.vy = clamp(d.vy, -1600, 1600);
      c.spin = 0;
      return;
    }
    if (c.mode === "sleep" && c.agent.job !== "offline") this.wake(c);
    this.cb.onOpen(c.agent.id);
  };

  private onResize = () => {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    for (const c of this.crabs.values()) {
      c.x = clamp(c.x, -this.inset, this.w - this.W + this.inset);
      c.y = clamp(c.y, -this.H * 6, this.h - this.H);
      this.stick(c);
    }
    this.perchClock = 0;
  };

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.run();
  };
}
