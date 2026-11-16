// ai-excited-01 — "Golden Ring Breach"
// A humpback whale bursting vertically through a glowing golden ring at
// sunset. The whole image is drawn procedurally, pixel by pixel, with the
// Node standard library only (node:fs, node:zlib, node:path). No images are
// loaded, no network is touched, nothing depends on the clock: the same
// fixed seed always produces the same bytes.
//
// Composition (1024 x 1024, horizon at y = 648):
//   sky    — indigo -> plum -> terracotta -> orange -> gold gradient
//   sun    — low, bright disc sitting on the waterline, centre x = 512
//   ring   — a golden halo floating just above the sea, tilted in perspective
//   whale  — a dark backlit silhouette rising straight up through the ring,
//            warm gold rim light on its sunward flank
//   spray  — arcs of droplets thrown off the breach
//   foam   — a white burst where the whale leaves the water
//   sea    — teal water with a shimmering sun-reflection column
//   birds  — a few distant birds scattered across the sky
//   vignette — soft darkening at the corners so the eye stays on the breach
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The program writes entry.png into MAKEFUN_OUTPUT_DIR (or /output).

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

export const WIDTH = 1024;
export const HEIGHT = 1024;
export const HORIZON = 648;

// ---------------------------------------------------------------------------
// Deterministic random numbers (mulberry32). One fixed seed drives every
// jittered element — spray, foam, birds, reflection — so two runs are
// byte-identical.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0xae01c01d);
const rand = (lo: number, hi: number): number => lo + rng() * (hi - lo);

// ---------------------------------------------------------------------------
// Colour helpers. Colours are [r, g, b] triples in 0..255.
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// A vertical gradient defined by stops: [position 0..1, colour].
function gradientAt(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      return mix(c0, c1, (t - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGBA buffer with source-over blending and a few helpers.
// ---------------------------------------------------------------------------
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array; // row-major, 4 bytes per pixel

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
    for (let i = 3; i < this.px.length; i += 4) this.px[i] = 255;
  }

  // Source-over blend of one pixel. `a` is 0..1.
  dot(x: number, y: number, c: RGB, a: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= this.w || yi < 0 || yi >= this.h || a <= 0) return;
    const o = (yi * this.w + xi) * 4;
    const inv = 1 - a;
    this.px[o] = c[0] * a + this.px[o] * inv;
    this.px[o + 1] = c[1] * a + this.px[o + 1] * inv;
    this.px[o + 2] = c[2] * a + this.px[o + 2] * inv;
  }

  // Additive glow: pushes the pixel toward white/warmth instead of covering.
  glow(x: number, y: number, c: RGB, a: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= this.w || yi < 0 || yi >= this.h || a <= 0) return;
    const o = (yi * this.w + xi) * 4;
    this.px[o] = Math.min(255, this.px[o] + c[0] * a);
    this.px[o + 1] = Math.min(255, this.px[o + 1] + c[1] * a);
    this.px[o + 2] = Math.min(255, this.px[o + 2] + c[2] * a);
  }

  // Filled disc, optionally with a soft edge (falloff in pixels).
  disc(cx: number, cy: number, r: number, c: RGB, a: number, soft = 0): void {
    if (r <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - r - soft));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r + soft));
    const y0 = Math.max(0, Math.floor(cy - r - soft));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r + soft));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r + soft) continue;
        let alpha = a;
        if (soft > 0 && d > r) alpha = a * (1 - (d - r) / soft);
        this.dot(x, y, c, alpha);
      }
    }
  }

  // Soft radial halo: brightness falls off with distance, additive.
  halo(cx: number, cy: number, r: number, c: RGB, strength: number): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        const fall = (1 - d) * (1 - d);
        this.glow(x, y, c, strength * fall);
      }
    }
  }

  // Filled polygon via the even-odd scanline rule.
  polygon(points: Array<[number, number]>, c: RGB, a: number): void {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.ceil(minY));
    const y1 = Math.min(this.h - 1, Math.floor(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1p] = points[i];
        const [x2, y2p] = points[(i + 1) % points.length];
        if ((y1p <= y && y2p > y) || (y2p <= y && y1p > y)) {
          xs.push(x1 + ((y - y1p) / (y2p - y1p)) * (x2 - x1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.dot(x, y, c, a);
      }
    }
  }

  // A thick polyline drawn as a chain of discs — used for spray arcs,
  // bird strokes and the whale's rim light.
  stroke(points: Array<[number, number]>, width: number, c: RGB, a: number): void {
    if (points.length < 2) return;
    for (let i = 0; i + 1 < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(1, Math.ceil(len / (width * 0.4)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        this.disc(lerp(x1, x2, t), lerp(y1, y2, t), width / 2, c, a, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Catmull-Rom spline sampling: turns a few control points into a smooth
// curve, used for the whale's body outline and the spray arcs.
// ---------------------------------------------------------------------------
function catmullRom(pts: Array<[number, number]>, samplesPerSpan = 10): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const ext: Array<[number, number]> = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 0; i + 3 < ext.length; i++) {
    const [x0, y0] = ext[i];
    const [x1, y1] = ext[i + 1];
    const [x2, y2] = ext[i + 2];
    const [x3, y3] = ext[i + 3];
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = s / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (zlib deflate + CRC32), written from scratch.
// Pixels are emitted with filter type 0 (None) on every scanline.
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(cv: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(cv.h * (1 + cv.w * 4));
  for (let y = 0; y < cv.h; y++) {
    raw[y * (1 + cv.w * 4)] = 0;
    raw.set(cv.px.subarray(y * cv.w * 4, (y + 1) * cv.w * 4), y * (1 + cv.w * 4) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const SKY_STOPS: Array<[number, RGB]> = [
  [0.0, [22, 12, 58]], // deep indigo, zenith
  [0.28, [58, 26, 84]], // plum
  [0.52, [122, 45, 92]], // dusky magenta
  [0.72, [196, 88, 58]], // terracotta
  [0.88, [240, 138, 46]], // orange
  [1.0, [255, 196, 77]], // gold at the horizon
];
const SEA_STOPS: Array<[number, RGB]> = [
  [0.0, [16, 78, 96]], // teal at the waterline
  [0.45, [11, 55, 74]],
  [1.0, [5, 34, 54]], // deep water at the bottom
];
const SUN_CORE: RGB = [255, 224, 130];
const SUN_GLOW: RGB = [255, 150, 58];
// The sun sits off-centre (right of the whale) so the whale does not hide
// it; its reflection column runs straight down from it.
const SUN_X = 800;
const RING_BRIGHT: RGB = [255, 220, 120];
const RING_MID: RGB = [232, 169, 28];
const RING_DARK: RGB = [138, 90, 16];
const WHALE_BODY: RGB = [18, 24, 48];
const WHALE_BELLY: RGB = [30, 38, 70];
const RIM_GOLD: RGB = [255, 179, 71];
const FOAM_WHITE: RGB = [255, 252, 244];
const FOAM_CREAM: RGB = [255, 233, 196];

// ---------------------------------------------------------------------------
// Sky: vertical gradient, then a warm wash that deepens toward the horizon.
// ---------------------------------------------------------------------------
function drawSky(cv: Canvas): void {
  for (let y = 0; y < HORIZON; y++) {
    const c = gradientAt(SKY_STOPS, y / HORIZON);
    for (let x = 0; x < cv.w; x++) cv.dot(x, y, c, 1);
  }
  // A faint horizontal band of haze just above the horizon.
  for (let y = HORIZON - 90; y < HORIZON; y++) {
    const t = (y - (HORIZON - 90)) / 90;
    for (let x = 0; x < cv.w; x++) cv.dot(x, y, [255, 170, 80], 0.10 * t);
  }
}

// ---------------------------------------------------------------------------
// Sun: a bright disc half-sunk on the waterline with a wide additive halo
// and a few thin horizontal light streaks across the sky.
// ---------------------------------------------------------------------------
function drawSun(cv: Canvas): void {
  const cx = SUN_X;
  const cy = HORIZON - 40;
  cv.halo(cx, cy, 330, SUN_GLOW, 0.5);
  cv.halo(cx, cy, 180, [255, 190, 90], 0.55);
  cv.disc(cx, cy, 52, SUN_CORE, 1, 3);
  cv.disc(cx, cy, 38, [255, 240, 180], 1, 2);
  // Thin light streaks radiating left and right through the haze.
  for (let i = 0; i < 7; i++) {
    const y = cy - 26 + i * 9;
    const half = 300 - Math.abs(i - 3) * 38;
    for (let x = cx - half; x <= cx + half; x++) {
      cv.glow(x, y, [255, 190, 110], 0.10 * (1 - Math.abs(x - cx) / half));
    }
  }
}

// ---------------------------------------------------------------------------
// Sea: teal gradient, a darker swell band at the waterline, then the sun's
// reflection column — a vertical band of jittered gold dashes that widen
// and fade as they run down toward the viewer.
// ---------------------------------------------------------------------------
function drawSea(cv: Canvas): void {
  for (let y = HORIZON; y < cv.h; y++) {
    const c = gradientAt(SEA_STOPS, (y - HORIZON) / (cv.h - HORIZON));
    for (let x = 0; x < cv.w; x++) cv.dot(x, y, c, 1);
  }
  // Gentle swell lines: long, low, darker arcs across the water.
  for (let s = 0; s < 9; s++) {
    const y = HORIZON + 26 + s * 38;
    const amp = 5 + s * 1.6;
    const phase = rand(0, Math.PI * 2);
    for (let x = 0; x < cv.w; x += 2) {
      const yy = y + Math.sin(x / 190 + phase) * amp;
      cv.dot(x, yy, [4, 26, 44], 0.35);
      cv.dot(x, yy + 1, [30, 110, 128], 0.22);
    }
  }
  // Sun-reflection column, running down from the sun.
  for (let y = HORIZON + 4; y < cv.h - 8; y += 3) {
    const depth = (y - HORIZON) / (cv.h - HORIZON);
    const halfW = 34 + depth * 150;
    const n = Math.floor(3 + depth * 9);
    for (let i = 0; i < n; i++) {
      const x = SUN_X + rand(-halfW, halfW);
      const w = rand(14, 46) * (0.6 + depth);
      const gold: RGB = [255, 190 + Math.floor(rand(-30, 30)), 90];
      const a = rand(0.10, 0.42) * (1 - depth * 0.45);
      for (let dx = -w / 2; dx <= w / 2; dx++) {
        cv.glow(x + dx, y + rand(-0.5, 0.5), gold, a * (1 - Math.abs(dx) / (w / 2)));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The golden ring. It lies almost flat, seen at a shallow angle, so on
// screen it is a wide ellipse. Its far (upper) arc is drawn behind the
// whale and its near (lower) arc in front of it, which is what makes the
// whale read as passing *through* the ring.
// ---------------------------------------------------------------------------
const RING = { cx: 512, cy: 452, rx: 236, ry: 64, tilt: -0.045, thick: 17 };

function ringPoint(angle: number): [number, number] {
  const { cx, cy, rx, ry, tilt } = RING;
  const ex = Math.cos(angle) * rx;
  const ey = Math.sin(angle) * ry;
  return [
    cx + ex * Math.cos(tilt) - ey * Math.sin(tilt),
    cy + ex * Math.sin(tilt) + ey * Math.cos(tilt),
  ];
}

// Draw one arc of the ellipse. `a0..a1` is the angle range; the top of the
// arc catches the sun (bright) and the bottom falls into shade.
function drawRingArc(cv: Canvas, a0: number, a1: number, front: boolean): void {
  const steps = 260;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) pts.push(ringPoint(a0 + ((a1 - a0) * i) / steps));
  // Soft glow behind the metal first, then the metal itself.
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const sunSide = 1 - Math.abs(Math.sin((a0 + ((a1 - a0) * i) / steps) - Math.PI / 2)) * 0.4;
    cv.disc(x, y, RING.thick * 1.5, SUN_GLOW, 0.10 * sunSide, 6);
  }
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const ang = a0 + ((a1 - a0) * i) / steps;
    // Bright on the sunward (upper-left) side, dark on the far side.
    const lit = 0.5 + 0.5 * Math.cos(ang - Math.PI * 0.85);
    const c = mix(RING_DARK, RING_BRIGHT, Math.pow(lit, 1.4));
    cv.disc(x, y, RING.thick / 2, c, 1, 1);
    if (front) {
      // A thin hot highlight along the top edge of the near arc.
      cv.disc(x, y - RING.thick * 0.28, RING.thick * 0.16, [255, 240, 180], 0.9, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// The whale. A vertical humpback silhouette built from two Catmull-Rom
// outlines (left flank and right flank) joined at the rostrum and at the
// tail stock, plus separate tail flukes and a pectoral fin. The body is a
// dark backlit mass; a warm rim of sunset light runs down its right flank
// and a cooler sheen down its left.
// ---------------------------------------------------------------------------
const WHALE_CX = 512;

function whaleOutline(): { left: Array<[number, number]>; right: Array<[number, number]> } {
  // Control points run from the tip of the rostrum (top) down to the tail
  // stock (bottom). x offsets are from the centre line.
  const leftCtrl: Array<[number, number]> = [
    [WHALE_CX, 168],
    [WHALE_CX - 26, 196],
    [WHALE_CX - 52, 252],
    [WHALE_CX - 74, 330],
    [WHALE_CX - 82, 408],
    [WHALE_CX - 76, 486],
    [WHALE_CX - 58, 556],
    [WHALE_CX - 40, 612],
    [WHALE_CX - 26, 652],
  ];
  const rightCtrl: Array<[number, number]> = [
    [WHALE_CX, 168],
    [WHALE_CX + 30, 198],
    [WHALE_CX + 56, 256],
    [WHALE_CX + 78, 334],
    [WHALE_CX + 86, 412],
    [WHALE_CX + 80, 488],
    [WHALE_CX + 62, 558],
    [WHALE_CX + 44, 614],
    [WHALE_CX + 28, 652],
  ];
  return { left: catmullRom(leftCtrl, 12), right: catmullRom(rightCtrl, 12) };
}

function drawWhale(cv: Canvas): void {
  const { left, right } = whaleOutline();
  const body = [...left, ...right.slice().reverse()];
  cv.polygon(body, WHALE_BODY, 1);

  // A subtle belly sheen: a narrower, slightly lighter shape on the
  // shadow side, so the body is not one flat slab.
  const bellyLeft = catmullRom(
    [
      [WHALE_CX - 18, 250],
      [WHALE_CX - 44, 330],
      [WHALE_CX - 52, 420],
      [WHALE_CX - 44, 510],
      [WHALE_CX - 26, 590],
    ],
    10,
  );
  const bellyRight = catmullRom(
    [
      [WHALE_CX - 18, 250],
      [WHALE_CX - 6, 340],
      [WHALE_CX - 2, 430],
      [WHALE_CX - 10, 520],
      [WHALE_CX - 26, 590],
    ],
    10,
  );
  cv.polygon([...bellyLeft, ...bellyRight.slice().reverse()], WHALE_BELLY, 0.85);

  // Throat grooves: faint vertical lines on the lower body.
  for (let g = 0; g < 5; g++) {
    const gx = WHALE_CX - 34 + g * 15;
    const pts: Array<[number, number]> = [];
    for (let y = 470; y <= 620; y += 12) {
      pts.push([gx + Math.sin(y / 55 + g) * 4, y]);
    }
    cv.stroke(pts, 2.5, [8, 12, 30], 0.5);
  }

  // Tail flukes: two broad lobes spreading from the tail stock, half
  // buried in the foam at the waterline.
  const stockY = 652;
  const flukeL = catmullRom(
    [
      [WHALE_CX - 22, stockY - 6],
      [WHALE_CX - 70, stockY + 6],
      [WHALE_CX - 132, stockY - 14],
      [WHALE_CX - 168, stockY - 44],
      [WHALE_CX - 128, stockY - 62],
      [WHALE_CX - 74, stockY - 52],
      [WHALE_CX - 34, stockY - 34],
    ],
    10,
  );
  const flukeR = catmullRom(
    [
      [WHALE_CX + 24, stockY - 6],
      [WHALE_CX + 74, stockY + 8],
      [WHALE_CX + 136, stockY - 10],
      [WHALE_CX + 172, stockY - 40],
      [WHALE_CX + 132, stockY - 60],
      [WHALE_CX + 78, stockY - 52],
      [WHALE_CX + 36, stockY - 34],
    ],
    10,
  );
  cv.polygon([...flukeL, ...flukeR.slice().reverse()], WHALE_BODY, 1);

  // Pectoral fin sweeping out to the viewer's left, catching the light.
  const fin = catmullRom(
    [
      [WHALE_CX - 70, 470],
      [WHALE_CX - 128, 512],
      [WHALE_CX - 176, 566],
      [WHALE_CX - 196, 616],
      [WHALE_CX - 158, 600],
      [WHALE_CX - 112, 552],
      [WHALE_CX - 80, 508],
    ],
    10,
  );
  cv.polygon(fin, [15, 20, 42], 1);
  // A sliver of rim light along the fin's lower edge.
  cv.stroke(
    catmullRom(
      [
        [WHALE_CX - 128, 512],
        [WHALE_CX - 176, 566],
        [WHALE_CX - 196, 616],
      ],
      8,
    ),
    3,
    RIM_GOLD,
    0.75,
  );

  // Rim light: the sunset edge on the whale's right flank, brightest near
  // the ring and fading toward the rostrum and the tail.
  const rim = right.slice(4, -3);
  for (let i = 0; i < rim.length; i++) {
    const [x, y] = rim[i];
    const t = i / (rim.length - 1);
    const strength = 0.35 + 0.6 * Math.sin(t * Math.PI);
    cv.disc(x + 1, y, 4.5, RIM_GOLD, strength * 0.55, 3);
    cv.disc(x + 1, y, 2, [255, 220, 140], strength * 0.8, 1);
  }
  // A cooler, fainter edge on the left flank.
  const rimL = left.slice(6, -4);
  for (let i = 0; i < rimL.length; i++) {
    const [x, y] = rimL[i];
    cv.disc(x - 1, y, 2.5, [120, 130, 200], 0.35, 2);
  }
}

// ---------------------------------------------------------------------------
// Spray: arcs of droplets thrown off the breach, plus a soft mist halo
// around the rostrum. Droplets are small discs with a bright core; the
// mist is many large, very faint discs.
// ---------------------------------------------------------------------------
function drawSpray(cv: Canvas): void {
  // Mist around the head.
  for (let i = 0; i < 55; i++) {
    const ang = rand(0, Math.PI * 2);
    const r = rand(10, 110);
    const x = WHALE_CX + Math.cos(ang) * r * 1.15;
    const y = 210 + Math.sin(ang) * r * 0.8 - r * 0.25;
    cv.disc(x, y, rand(8, 24), [255, 240, 220], rand(0.03, 0.09), 8);
  }
  // Droplet arcs: several parabolic streams fanning out from the body.
  const streams: Array<{ x0: number; y0: number; vx: number; vy: number; n: number }> = [
    { x0: 470, y0: 300, vx: -3.4, vy: -7.5, n: 26 },
    { x0: 560, y0: 330, vx: 3.8, vy: -7.0, n: 26 },
    { x0: 448, y0: 420, vx: -4.6, vy: -5.2, n: 22 },
    { x0: 580, y0: 440, vx: 4.9, vy: -4.6, n: 22 },
    { x0: 512, y0: 190, vx: 0.6, vy: -8.6, n: 18 },
    { x0: 512, y0: 190, vx: -1.2, vy: -8.2, n: 14 },
  ];
  for (const s of streams) {
    for (let i = 0; i < s.n; i++) {
      const t = i / s.n;
      const x = s.x0 + s.vx * i * 6 + rand(-6, 6);
      const y = s.y0 + s.vy * i * 6 + 0.42 * i * i + rand(-5, 5);
      const size = rand(1.5, 4.5) * (1 - t * 0.45);
      const alpha = rand(0.5, 0.95) * (1 - t * 0.35);
      cv.disc(x, y, size, FOAM_WHITE, alpha, 1);
      cv.disc(x - size * 0.25, y - size * 0.25, size * 0.45, [255, 255, 255], alpha, 0.5);
    }
  }
  // A few lone droplets flung wide.
  for (let i = 0; i < 22; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = WHALE_CX + side * rand(120, 300);
    const y = rand(200, 480);
    cv.disc(x, y, rand(1.5, 3.5), FOAM_WHITE, rand(0.4, 0.85), 1);
  }
}

// ---------------------------------------------------------------------------
// Foam burst: a ring of white peaks and bubbles where the whale leaves the
// water, with a few long streaks of foam running outward on the surface.
// ---------------------------------------------------------------------------
function drawFoam(cv: Canvas): void {
  const cy = HORIZON + 6;
  // Long foam streaks on the water first (behind the burst).
  for (let i = 0; i < 26; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x0 = WHALE_CX + side * rand(90, 160);
    const len = rand(60, 190);
    const y = cy + rand(2, 22);
    for (let x = 0; x < len; x++) {
      cv.dot(x0 + side * x, y + Math.sin(x / 22) * 1.5, FOAM_CREAM, rand(0.25, 0.6));
    }
  }
  // The burst itself: overlapping discs, tallest at the centre.
  for (let i = 0; i < 240; i++) {
    const ang = rand(-Math.PI, 0); // upper half only
    const r = rand(0, 150);
    const x = WHALE_CX + Math.cos(ang) * r * 1.25;
    const y = cy - Math.abs(Math.sin(ang)) * r * 0.55 - rand(0, 26) * (1 - r / 170);
    const size = rand(6, 30) * (1 - Math.abs(x - WHALE_CX) / 260);
    const c = rng() < 0.6 ? FOAM_WHITE : FOAM_CREAM;
    cv.disc(x, y, Math.max(3, size), c, rand(0.55, 0.95), 4);
  }
  // Sharp foam peaks poking upward around the body.
  for (let i = 0; i < 34; i++) {
    const x = WHALE_CX + rand(-150, 150);
    const h = rand(14, 64) * (1 - Math.abs(x - WHALE_CX) / 200);
    const tip: [number, number] = [x, cy - h];
    const baseL: [number, number] = [x - rand(8, 18), cy + 2];
    const baseR: [number, number] = [x + rand(8, 18), cy + 2];
    cv.polygon([tip, baseL, baseR], FOAM_WHITE, rand(0.75, 0.95));
  }
  // Bubbles scattered on the surface.
  for (let i = 0; i < 60; i++) {
    const x = WHALE_CX + rand(-190, 190);
    const y = cy + rand(4, 34);
    cv.disc(x, y, rand(1.5, 5), FOAM_WHITE, rand(0.3, 0.7), 1);
  }
}

// ---------------------------------------------------------------------------
// Birds: a few small distant birds, each two short strokes meeting at a
// point, scattered high in the sky and scaled by distance.
// ---------------------------------------------------------------------------
function drawBirds(cv: Canvas): void {
  const flock: Array<[number, number, number]> = [
    [180, 170, 1.0],
    [228, 196, 0.8],
    [150, 232, 0.65],
    [820, 150, 1.0],
    [872, 186, 0.75],
    [786, 214, 0.6],
    [700, 260, 0.55],
    [330, 120, 0.7],
    [640, 110, 0.6],
  ];
  for (const [x, y, s] of flock) {
    const span = 16 * s;
    const lift = 7 * s;
    cv.stroke(
      [
        [x - span, y - lift],
        [x, y],
        [x + span, y - lift],
      ],
      2.4 * s,
      [26, 16, 44],
      0.85,
    );
  }
}

// ---------------------------------------------------------------------------
// Vignette: gentle darkening toward the corners so the eye stays on the
// breach and the ring.
// ---------------------------------------------------------------------------
function drawVignette(cv: Canvas): void {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      if (d > 0.62) {
        cv.dot(x, y, [8, 6, 24], (d - 0.62) * 0.55);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compose and write the image.
// ---------------------------------------------------------------------------
function render(): Canvas {
  const cv = new Canvas(WIDTH, HEIGHT);
  drawSky(cv);
  drawSun(cv);
  drawBirds(cv);
  // The sea comes before the whale: the whale rises out of it, and the
  // waterline cuts the sun's lower half so the sun sits on the water.
  drawSea(cv);
  // Far arc of the ring, behind the whale.
  drawRingArc(cv, Math.PI, Math.PI * 2, false);
  drawWhale(cv);
  // Near arc of the ring, in front of the whale's lower body.
  drawRingArc(cv, 0, Math.PI, true);
  drawSpray(cv);
  // Foam last (after the sea) so the burst stays the brightest thing at
  // the waterline, half-burying the tail flukes.
  drawFoam(cv);
  drawVignette(cv);
  return cv;
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePng(render());
  writeFileSync(join(outDir, "entry.png"), png);
}

main();
