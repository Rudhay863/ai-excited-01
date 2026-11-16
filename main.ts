// ai-excited-01 — "The Breach Through the Golden Ring"
// A Node 22 program (standard library only) that procedurally draws one
// original image and writes it to /output/entry.png, or to
// $MAKEFUN_OUTPUT_DIR/entry.png when that variable is set.
//
// The scene: a humpback whale breaches straight up through a ring of
// golden light at sunset. Spray arcs off the breach, birds scatter, and a
// deep teal sea sits under a burning-orange sky. One hero subject, bold
// shapes, a tight palette, strong vertical momentum — the single thrilling
// moment, drawn fresh by this code. No text appears in the image.
//
// Everything is deterministic: fixed constants plus a seeded PRNG. No
// Date, no Math.random, no network, no file reads. Two runs produce
// byte-identical PNGs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const WIDTH = 1024;
const HEIGHT = 1024;
const SEA_LINE = 648; // y coordinate of the horizon

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32). Used only for spray droplets and the small
// jitter on bird positions, so the picture never changes between runs.
// ---------------------------------------------------------------------------
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(0xb3eac401);

// ---------------------------------------------------------------------------
// Small maths helpers.
// ---------------------------------------------------------------------------
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

type Colour = [number, number, number];

function blend(a: Colour, b: Colour, t: number): Colour {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ---------------------------------------------------------------------------
// Palette.
// ---------------------------------------------------------------------------
const INDIGO: Colour = [36, 27, 77]; // sky, top
const PLUM: Colour = [109, 42, 99];
const TERRA: Colour = [193, 75, 74];
const EMBER: Colour = [240, 127, 53];
const GOLDEN: Colour = [255, 196, 107]; // sky, near the horizon
const SUNLIGHT: Colour = [255, 233, 168];
const RING: Colour = [255, 215, 106];
const TEAL: Colour = [13, 85, 96]; // sea, lit near the horizon
const ABYSS: Colour = [4, 34, 46]; // sea, deep
const WHALE: Colour = [15, 36, 56]; // backlit body, dark side
const WHALE_LIT: Colour = [34, 66, 88]; // backlit body, lighter side
const RIMLIGHT: Colour = [255, 179, 71]; // warm gold rim on the flanks
const SPRAY: Colour = [235, 246, 248];
const BIRD_INK: Colour = [26, 16, 48];

// ---------------------------------------------------------------------------
// PNG encoder, written from scratch on the standard library: CRC32 table,
// chunk framing, zlib deflate. RGB, 8-bit. Two row-filter variants are
// deflated and the smaller one wins; both are deterministic.
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function toPng(rgb: Uint8Array, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type 2 = truecolour RGB
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter: adaptive per row
  header[12] = 0; // no interlace

  const compressed: Buffer[] = [];
  for (const filter of [0, 1]) {
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
      const row = y * (1 + width * 3);
      raw[row] = filter;
      const src = y * width * 3;
      for (let x = 0; x < width; x++) {
        const dst = row + 1 + x * 3;
        const s = src + x * 3;
        if (filter === 0) {
          raw[dst] = rgb[s];
          raw[dst + 1] = rgb[s + 1];
          raw[dst + 2] = rgb[s + 2];
        } else {
          // Sub filter: store each byte minus the byte 3 positions left.
          const l = x === 0 ? 0 : rgb[s - 3];
          const lg = x === 0 ? 0 : rgb[s - 2];
          const lb = x === 0 ? 0 : rgb[s - 1];
          raw[dst] = (rgb[s] - l) & 0xff;
          raw[dst + 1] = (rgb[s + 1] - lg) & 0xff;
          raw[dst + 2] = (rgb[s + 2] - lb) & 0xff;
        }
      }
    }
    compressed.push(deflateSync(raw, { level: 9 }));
  }
  const best = compressed[0].length <= compressed[1].length ? compressed[0] : compressed[1];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", best),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Pixel buffer with read/write helpers.
// ---------------------------------------------------------------------------
const frame = new Uint8Array(WIDTH * HEIGHT * 3);

function put(x: number, y: number, c: Colour): void {
  const i = (y * WIDTH + x) * 3;
  frame[i] = clamp(Math.round(c[0]), 0, 255);
  frame[i + 1] = clamp(Math.round(c[1]), 0, 255);
  frame[i + 2] = clamp(Math.round(c[2]), 0, 255);
}

function peek(x: number, y: number): Colour {
  const i = (y * WIDTH + x) * 3;
  return [frame[i], frame[i + 1], frame[i + 2]];
}

// ---------------------------------------------------------------------------
// Background: sunset sky above the horizon, teal sea below it.
// ---------------------------------------------------------------------------
function skyAt(x: number, y: number): Colour {
  const t = y / SEA_LINE;
  let c: Colour;
  if (t < 0.35) c = blend(INDIGO, PLUM, t / 0.35);
  else if (t < 0.62) c = blend(PLUM, TERRA, (t - 0.35) / 0.27);
  else if (t < 0.85) c = blend(TERRA, EMBER, (t - 0.62) / 0.23);
  else c = blend(EMBER, GOLDEN, (t - 0.85) / 0.15);
  // Warm glow spreading out from the low sun.
  const dx = x - 512;
  const dy = y - 592;
  const glow = Math.exp(-(dx * dx + dy * dy) / (2 * 270 * 270));
  return blend(c, [255, 210, 122], glow * 0.55);
}

function seaAt(x: number, y: number): Colour {
  const t = (y - SEA_LINE) / (HEIGHT - SEA_LINE);
  let c = blend(TEAL, ABYSS, Math.pow(t, 0.8));
  // Gentle wave banding.
  const wave = 0.028 * Math.sin(x * 0.045 + y * 0.11) + 0.02 * Math.sin(x * 0.013 - y * 0.05);
  c = [c[0] * (1 + wave), c[1] * (1 + wave), c[2] * (1 + wave)];
  // Warm light spilling down from the horizon.
  c = blend(c, [255, 190, 100], 0.35 * Math.exp(-(y - SEA_LINE) / 55));
  // The sun's reflection: a soft, shimmering vertical column.
  const column = 1 - Math.abs(x - 512) / 115;
  if (column > 0) {
    const shimmer = 0.55 + 0.45 * Math.sin(y * 0.11 + x * 0.021);
    const amount = column * column * shimmer * 0.42 * Math.exp(-(y - SEA_LINE) / 320);
    c = blend(c, [255, 196, 110], clamp(amount, 0, 0.6));
  }
  return c;
}

// ---------------------------------------------------------------------------
// The low sun and the ring of golden light. Drawn before the whale, so the
// whale passes in front of them: the breach goes THROUGH the ring.
// ---------------------------------------------------------------------------
const SUN = { x: 512, y: 592, r: 92 };
const HALO = { x: 512, y: 430, r: 215, band: 17 };

function paintSunAndRing(): void {
  for (let y = 0; y < SEA_LINE; y++) {
    for (let x = 0; x < WIDTH; x++) {
      // Sun disc, soft-edged.
      const toSun = Math.hypot(x - SUN.x, y - SUN.y);
      if (toSun < SUN.r + 6) {
        const edge = smoothstep(SUN.r + 4, SUN.r - 6, toSun);
        put(x, y, blend(peek(x, y), SUNLIGHT, edge));
      }
      // Golden ring: a bright band on its circle plus a halo falloff.
      const toRing = Math.hypot(x - HALO.x, y - HALO.y);
      const off = Math.abs(toRing - HALO.r);
      if (off < HALO.band + 60) {
        const core = 1 - smoothstep(HALO.band * 0.55, HALO.band, off);
        const halo = Math.exp(-off / 26) * 0.5;
        const amount = clamp(core * 0.95 + halo, 0, 1);
        put(x, y, blend(peek(x, y), RING, amount));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The whale: a breaching humpback built from a chain of discs along a
// curved spine (head high, tail at the water), with tail flukes and one
// pectoral fin. A dark backlit silhouette, with a warm gold rim on both
// flanks where the sunset catches it.
// ---------------------------------------------------------------------------
const SPINE: Array<[number, number]> = [
  [508, 702], // tail stock, at the water
  [500, 622],
  [492, 522],
  [490, 432],
  [496, 342],
  [508, 262],
  [520, 202],
  [530, 158], // snout, highest point
];

// Body width along the spine, tail -> belly -> head -> snout.
const WIDTHS: Array<[number, number]> = [
  [0.0, 24],
  [0.15, 34],
  [0.3, 62],
  [0.45, 78],
  [0.6, 72],
  [0.75, 58],
  [0.88, 44],
  [1.0, 20],
];

function widthAt(t: number): number {
  for (let i = 0; i < WIDTHS.length - 1; i++) {
    const [t0, r0] = WIDTHS[i];
    const [t1, r1] = WIDTHS[i + 1];
    if (t >= t0 && t <= t1) return lerp(r0, r1, (t - t0) / (t1 - t0));
  }
  return WIDTHS[WIDTHS.length - 1][1];
}

function spineAt(t: number): [number, number] {
  const last = SPINE.length - 1;
  const seg = clamp(t * last, 0, last - 0.0001);
  const i = Math.floor(seg);
  const f = seg - i;
  return [lerp(SPINE[i][0], SPINE[i + 1][0], f), lerp(SPINE[i][1], SPINE[i + 1][1], f)];
}

// The disc chain, computed once (deterministic).
type Disc = { x: number; y: number; r: number; t: number };
const DISCS: Disc[] = [];
for (let i = 0; i <= 60; i++) {
  const t = i / 60;
  const [x, y] = spineAt(t);
  DISCS.push({ x, y, r: widthAt(t), t });
}

// Signed inside-test for a rotated ellipse: <= 0 means inside.
function inEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
): number {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - cx;
  const dy = y - cy;
  const u = (dx * cos + dy * sin) / rx;
  const v = (-dx * sin + dy * cos) / ry;
  return u * u + v * v - 1;
}

function paintWhale(): void {
  for (let y = 120; y < 730; y++) {
    for (let x = 350; x < 690; x++) {
      // Nearest spine disc: negative distance means inside the body.
      let nearest = Infinity;
      let across = 0; // -1..1 across the body, for the rim light
      for (const d of DISCS) {
        const dist = Math.hypot(x - d.x, y - d.y) - d.r;
        if (dist < nearest) {
          nearest = dist;
          across = (x - d.x) / d.r;
        }
      }
      // Tail flukes: two swept lobes at the waterline.
      const flukeL = inEllipse(x, y, 438, 690, 72, 26, -0.32);
      const flukeR = inEllipse(x, y, 580, 686, 70, 24, 0.28);
      // Pectoral fin sweeping out to the right.
      const fin = inEllipse(x, y, 566, 472, 60, 16, 0.6);
      const inside = nearest <= 0 || flukeL <= 0 || flukeR <= 0 || fin <= 0;
      if (!inside) continue;
      // A couple of pixels of soft edge, so the outline anti-aliases.
      const edge = Math.min(nearest, flukeL * 30, flukeR * 30, fin * 30);
      const alpha = clamp(1 - edge / 2.5, 0, 1);
      if (alpha <= 0) continue;
      // Body shading: a little lighter toward the head, warm gold rim on
      // both flanks. The rim is for the body only, never flukes or fin.
      let c = blend(WHALE, WHALE_LIT, clamp((730 - y) / 560, 0, 1) * 0.55);
      if (nearest <= 0) {
        const rim = smoothstep(0.5, 0.95, Math.abs(across));
        c = blend(c, RIMLIGHT, rim * 0.8);
      } else {
        // Flukes and fin read darker, half-lost in the splash.
        c = [c[0] * 0.62, c[1] * 0.62, c[2] * 0.68];
      }
      put(x, y, blend(peek(x, y), c, alpha));
    }
  }
}

// ---------------------------------------------------------------------------
// Spray, foam and birds — the motion. Every droplet position comes from
// the seeded PRNG, so it is identical on every run.
// ---------------------------------------------------------------------------
type Drop = { x: number; y: number; r: number; a: number };

function makeSpray(): Drop[] {
  const drops: Drop[] = [];
  // A fan of spray bursting up and out from the breach point.
  for (let i = 0; i < 520; i++) {
    const angle = -Math.PI / 2 + (random() - 0.5) * 2.4; // mostly upward
    const dist = 40 + Math.pow(random(), 1.6) * 260;
    const x = 508 + Math.cos(angle) * dist * 1.15;
    const y = 655 + Math.sin(angle) * dist * 0.85;
    if (y < 130 || y > 760) continue;
    drops.push({ x, y, r: 1 + random() * 3.2, a: 0.45 + random() * 0.55 });
  }
  // Droplets streaming off the whale's flanks as it rises.
  for (let i = 0; i < 180; i++) {
    const t = 0.15 + random() * 0.7;
    const [sx, sy] = spineAt(t);
    const side = random() < 0.5 ? -1 : 1;
    const x = sx + side * (widthAt(t) + 4 + random() * 34);
    const y = sy + (random() - 0.5) * 26;
    drops.push({ x, y, r: 0.8 + random() * 2.2, a: 0.4 + random() * 0.5 });
  }
  return drops;
}

function paintDrops(drops: Drop[]): void {
  for (const d of drops) {
    const r = Math.ceil(d.r) + 1;
    for (let y = Math.floor(d.y - r); y <= Math.ceil(d.y + r); y++) {
      for (let x = Math.floor(d.x - r); x <= Math.ceil(d.x + r); x++) {
        if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
        const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y);
        if (dist >= d.r) continue;
        const a = d.a * (1 - smoothstep(d.r * 0.4, d.r, dist));
        put(x, y, blend(peek(x, y), SPRAY, a));
      }
    }
  }
}

// White foam bursting where the whale leaves the water, plus a rolling
// foam ring spreading on the surface around the breach.
function paintFoam(): void {
  for (let y = 624; y < 700; y++) {
    for (let x = 330; x < 700; x++) {
      const burst = Math.exp(
        -(Math.pow((x - 508) / 125, 2) + Math.pow((y - 656) / 22, 2)),
      );
      const ring = Math.exp(
        -Math.pow((Math.hypot((x - 508) / 168, (y - 652) / 24) - 1) * 3.0, 2),
      );
      const chop = 0.8 + 0.2 * Math.sin(x * 0.09 + Math.sin(y * 0.3) * 0.8);
      // Fade the foam out toward its left/right ends so it never reads
      // as a rectangular slab.
      const fade = 1 - smoothstep(0.55, 1, Math.abs(x - 508) / 185);
      const a = clamp((burst * 0.8 + ring * 0.5) * chop * fade, 0, 0.9);
      if (a > 0.02) put(x, y, blend(peek(x, y), SPRAY, a));
    }
  }
}

// Small scattering birds, drawn as dark chevrons — they sell the scale.
const BIRDS: Array<{ x: number; y: number; s: number }> = [
  { x: 178, y: 182, s: 13 },
  { x: 252, y: 138, s: 10 },
  { x: 332, y: 232, s: 12 },
  { x: 700, y: 168, s: 13 },
  { x: 772, y: 242, s: 11 },
  { x: 834, y: 148, s: 9 },
  { x: 148, y: 332, s: 10 },
  { x: 862, y: 332, s: 12 },
  { x: 640, y: 108, s: 9 },
];

function paintBirds(): void {
  for (const b of BIRDS) {
    const cx = b.x + (random() - 0.5) * 6;
    const cy = b.y + (random() - 0.5) * 6;
    const s = b.s;
    // Two short strokes meeting at the body: a swept "v".
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const lx = Math.round(cx - t * s);
      const ly = Math.round(cy - t * s * 0.42);
      const rx = Math.round(cx + t * s);
      const ry = Math.round(cy - t * s * 0.42);
      for (const [px, py] of [
        [lx, ly],
        [rx, ry],
        [lx, ly + 1],
        [rx, ry + 1],
      ]) {
        if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) put(px, py, BIRD_INK);
      }
    }
  }
}

// A gentle vignette so the eye stays on the centre.
function paintVignette(): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const d = Math.hypot((x - 512) / 512, (y - 470) / 512);
      const v = 1 - 0.16 * smoothstep(0.62, 1.05, d);
      const c = peek(x, y);
      put(x, y, [c[0] * v, c[1] * v, c[2] * v]);
    }
  }
}

// ---------------------------------------------------------------------------
// Render and write. Output goes to $MAKEFUN_OUTPUT_DIR/entry.png, or to
// /output/entry.png inside the grader's container.
// ---------------------------------------------------------------------------
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      put(x, y, y < SEA_LINE ? skyAt(x, y) : seaAt(x, y));
    }
  }
  paintSunAndRing();
  paintWhale();
  paintFoam();
  paintDrops(makeSpray());
  paintBirds();
  paintVignette();
  const png = toPng(frame, WIDTH, HEIGHT);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), png);
  console.log(`wrote ${join(outDir, "entry.png")} (${png.length} bytes)`);
}

main();
