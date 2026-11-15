// ai-excited-01 — "The Breach Through the Golden Ring"
// A program that PROCEDURALLY DRAWS one original image and writes it to
// /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png when set).
//
// Scene: a humpback whale breaches vertically through a ring of golden
// light at sunset — spray arcing, birds scattering, deep teal sea below a
// burning-orange sky. One clear hero subject, bold shapes, limited palette,
// strong vertical momentum. No text anywhere in the image.
//
// Pure Node standard library only (node:fs, node:path, node:zlib).
// Fully deterministic: fixed constants + a seeded PRNG. No Date, no
// Math.random, no network. Running it twice produces byte-identical PNGs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const HORIZON = 648; // y of the sea line

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32, fixed seed) — only used for spray droplets
// and bird placement jitter, so the output never changes between runs.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xae51c01d);

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

// ---------------------------------------------------------------------------
// PNG encoder (pure stdlib): CRC32 + zlib deflate, RGB, no filtering tricks
// beyond a per-image choice between "none" and "sub" row filters.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
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

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Build two filtered variants (filter 0 = none, filter 1 = sub) and keep
  // whichever deflates smaller. Both are deterministic.
  const variants: Buffer[] = [];
  for (const filter of [0, 1]) {
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
      const rowStart = y * (1 + width * 3);
      raw[rowStart] = filter;
      const src = y * width * 3;
      for (let x = 0; x < width; x++) {
        const dst = rowStart + 1 + x * 3;
        if (filter === 0) {
          raw[dst] = rgb[src + x * 3];
          raw[dst + 1] = rgb[src + x * 3 + 1];
          raw[dst + 2] = rgb[src + x * 3 + 2];
        } else {
          const left = x === 0 ? 0 : rgb[src + (x - 1) * 3];
          const leftG = x === 0 ? 0 : rgb[src + (x - 1) * 3 + 1];
          const leftB = x === 0 ? 0 : rgb[src + (x - 1) * 3 + 2];
          raw[dst] = (rgb[src + x * 3] - left) & 0xff;
          raw[dst + 1] = (rgb[src + x * 3 + 1] - leftG) & 0xff;
          raw[dst + 2] = (rgb[src + x * 3 + 2] - leftB) & 0xff;
        }
      }
    }
    variants.push(deflateSync(raw, { level: 9 }));
  }
  const idat = variants[0].length <= variants[1].length ? variants[0] : variants[1];
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Pixel buffer
// ---------------------------------------------------------------------------
const px = new Uint8Array(W * H * 3);
function setPx(x: number, y: number, c: RGB): void {
  const i = (y * W + x) * 3;
  px[i] = clamp(Math.round(c[0]), 0, 255);
  px[i + 1] = clamp(Math.round(c[1]), 0, 255);
  px[i + 2] = clamp(Math.round(c[2]), 0, 255);
}
function getPx(x: number, y: number): RGB {
  const i = (y * W + x) * 3;
  return [px[i], px[i + 1], px[i + 2]];
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const SKY_TOP: RGB = [36, 27, 77]; // deep indigo
const SKY_PLUM: RGB = [109, 42, 99];
const SKY_TERRA: RGB = [193, 75, 74];
const SKY_ORANGE: RGB = [240, 127, 53];
const SKY_GOLD: RGB = [255, 196, 107];
const SUN_CORE: RGB = [255, 233, 168];
const RING_GOLD: RGB = [255, 215, 106];
const SEA_TOP: RGB = [13, 85, 96]; // teal, lit near the horizon
const SEA_DEEP: RGB = [4, 34, 46];
const WHALE_DARK: RGB = [15, 36, 56];
const WHALE_LIGHT: RGB = [34, 66, 88];
const RIM_GOLD: RGB = [255, 179, 71];
const FOAM: RGB = [235, 246, 248];
const BIRD: RGB = [26, 16, 48];

// Sunset sky: piecewise gradient, then the sun's warm glow on top.
function skyColor(x: number, y: number): RGB {
  const t = y / HORIZON;
  let c: RGB;
  if (t < 0.35) c = mix(SKY_TOP, SKY_PLUM, t / 0.35);
  else if (t < 0.62) c = mix(SKY_PLUM, SKY_TERRA, (t - 0.35) / 0.27);
  else if (t < 0.85) c = mix(SKY_TERRA, SKY_ORANGE, (t - 0.62) / 0.23);
  else c = mix(SKY_ORANGE, SKY_GOLD, (t - 0.85) / 0.15);
  // Warm glow centred on the low sun.
  const dx = x - 512;
  const dy = y - 592;
  const glow = Math.exp(-(dx * dx + dy * dy) / (2 * 270 * 270));
  return mix(c, [255, 210, 122], glow * 0.55);
}

// Sea: teal gradient, gentle wave banding, and a shimmering gold column
// of reflected sunlight under the sun.
function seaColor(x: number, y: number): RGB {
  const t = (y - HORIZON) / (H - HORIZON);
  let c = mix(SEA_TOP, SEA_DEEP, Math.pow(t, 0.8));
  const wave =
    0.028 * Math.sin(x * 0.045 + y * 0.11) + 0.02 * Math.sin(x * 0.013 - y * 0.05);
  c = [c[0] * (1 + wave), c[1] * (1 + wave), c[2] * (1 + wave)];
  // Horizon glow fading downward.
  c = mix(c, [255, 190, 100], 0.35 * Math.exp(-(y - HORIZON) / 55));
  // Sun reflection column: soft vertical shimmer, fading with depth.
  const col = 1 - Math.abs(x - 512) / 115;
  if (col > 0) {
    const shimmer = 0.55 + 0.45 * Math.sin(y * 0.11 + x * 0.021);
    const amt = col * col * shimmer * 0.42 * Math.exp(-(y - HORIZON) / 320);
    c = mix(c, [255, 196, 110], clamp(amt, 0, 0.6));
  }
  return c;
}

// ---------------------------------------------------------------------------
// Sun disc + the ring of golden light (drawn before the whale, so the whale
// passes IN FRONT of them — the breach goes through the ring).
// ---------------------------------------------------------------------------
const SUN = { x: 512, y: 592, r: 92 };
const RING = { x: 512, y: 430, r: 215, w: 17 };

function drawSunAndRing(): void {
  for (let y = 0; y < HORIZON; y++) {
    for (let x = 0; x < W; x++) {
      // Sun disc with a soft edge.
      const ds = Math.hypot(x - SUN.x, y - SUN.y);
      if (ds < SUN.r + 6) {
        const edge = smoothstep(SUN.r + 4, SUN.r - 6, ds);
        setPx(x, y, mix(getPx(x, y), SUN_CORE, edge));
      }
      // Golden ring: a glowing band around its circle, plus a halo falloff.
      const dr = Math.hypot(x - RING.x, y - RING.y);
      const band = Math.abs(dr - RING.r);
      if (band < RING.w + 60) {
        const core = 1 - smoothstep(RING.w * 0.55, RING.w, band);
        const halo = Math.exp(-band / 26) * 0.5;
        const amt = clamp(core * 0.95 + halo, 0, 1);
        setPx(x, y, mix(getPx(x, y), RING_GOLD, amt));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The whale — a breaching humpback, built as a chain of discs along a
// curved spine (head high, tail at the water), plus tail flukes and one
// pectoral fin. Dark backlit silhouette with a warm gold rim on both flanks.
// ---------------------------------------------------------------------------
const SPINE: Array<[number, number]> = [
  [508, 702],
  [500, 622],
  [492, 522],
  [490, 432],
  [496, 342],
  [508, 262],
  [520, 202],
  [530, 158],
];
// Radius profile along the spine (tail stock -> belly -> head -> snout).
const RADII: Array<[number, number]> = [
  [0.0, 24],
  [0.15, 34],
  [0.3, 62],
  [0.45, 78],
  [0.6, 72],
  [0.75, 58],
  [0.88, 44],
  [1.0, 20],
];

function radiusAt(t: number): number {
  for (let i = 0; i < RADII.length - 1; i++) {
    const [t0, r0] = RADII[i];
    const [t1, r1] = RADII[i + 1];
    if (t >= t0 && t <= t1) return lerp(r0, r1, (t - t0) / (t1 - t0));
  }
  return RADII[RADII.length - 1][1];
}

function spinePoint(t: number): [number, number] {
  const n = SPINE.length - 1;
  const seg = clamp(t * n, 0, n - 0.0001);
  const i = Math.floor(seg);
  const f = seg - i;
  return [lerp(SPINE[i][0], SPINE[i + 1][0], f), lerp(SPINE[i][1], SPINE[i + 1][1], f)];
}

// Precompute the disc chain once (deterministic).
const DISCS: Array<{ x: number; y: number; r: number; t: number }> = [];
for (let i = 0; i <= 60; i++) {
  const t = i / 60;
  const [x, y] = spinePoint(t);
  DISCS.push({ x, y, r: radiusAt(t), t });
}

function ellipseInside(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
): number {
  // Returns signed distance-ish value: <= 0 means inside the ellipse.
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - cx;
  const dy = y - cy;
  const u = (dx * cos + dy * sin) / rx;
  const v = (-dx * sin + dy * cos) / ry;
  return u * u + v * v - 1;
}

function drawWhale(): void {
  const x0 = 350;
  const x1 = 690;
  const y0 = 120;
  const y1 = 730;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Distance to the nearest spine disc (negative = inside the body).
      let best = Infinity;
      let bestR = 1;
      let bestDx = 0;
      for (const d of DISCS) {
        const dist = Math.hypot(x - d.x, y - d.y) - d.r;
        if (dist < best) {
          best = dist;
          bestR = d.r;
          bestDx = (x - d.x) / d.r;
        }
      }
      // Tail flukes: two swept lobes at the waterline.
      const flukeL = ellipseInside(x, y, 438, 690, 72, 26, -0.32);
      const flukeR = ellipseInside(x, y, 580, 686, 70, 24, 0.28);
      // Pectoral fin sweeping out to the right.
      const fin = ellipseInside(x, y, 566, 472, 60, 16, 0.6);
      const inside = best <= 0 || flukeL <= 0 || flukeR <= 0 || fin <= 0;
      if (!inside) continue;
      // Soft edge: anti-alias the outline by a couple of pixels.
      const edgeDist = Math.min(best, flukeL * 30, flukeR * 30, fin * 30);
      const alpha = clamp(1 - edgeDist / 2.5, 0, 1);
      if (alpha <= 0) continue;
      // Body shading: slightly lighter toward the head, warm gold rim on
      // both flanks where the backlight catches the outline. The rim
      // applies only to the body itself, never to flukes or fin.
      let c = mix(WHALE_DARK, WHALE_LIGHT, clamp((730 - y) / 560, 0, 1) * 0.55);
      if (best <= 0) {
        const rim = smoothstep(0.5, 0.95, Math.abs(bestDx));
        c = mix(c, RIM_GOLD, rim * 0.8);
      } else {
        // Flukes and fin: darker, as if half-submerged in the splash.
        c = [c[0] * 0.62, c[1] * 0.62, c[2] * 0.68];
      }
      setPx(x, y, mix(getPx(x, y), c, alpha));
    }
  }
}

// ---------------------------------------------------------------------------
// Spray, foam and birds — the motion. All droplet positions come from the
// seeded PRNG above, so they are identical on every run.
// ---------------------------------------------------------------------------
interface Droplet {
  x: number;
  y: number;
  r: number;
  a: number;
}

function buildSpray(): Droplet[] {
  const drops: Droplet[] = [];
  // Fan of spray bursting up and out from the breach point at the waterline.
  for (let i = 0; i < 520; i++) {
    const ang = -Math.PI / 2 + (rand() - 0.5) * 2.4; // mostly upward
    const dist = 40 + Math.pow(rand(), 1.6) * 260;
    const x = 508 + Math.cos(ang) * dist * 1.15;
    const y = 655 + Math.sin(ang) * dist * 0.85;
    if (y < 130 || y > 760) continue;
    drops.push({ x, y, r: 1 + rand() * 3.2, a: 0.45 + rand() * 0.55 });
  }
  // Trailing droplets streaming off the whale's flanks as it rises.
  for (let i = 0; i < 180; i++) {
    const t = 0.15 + rand() * 0.7;
    const [sx, sy] = spinePoint(t);
    const side = rand() < 0.5 ? -1 : 1;
    const x = sx + side * (radiusAt(t) + 4 + rand() * 34);
    const y = sy + (rand() - 0.5) * 26;
    drops.push({ x, y, r: 0.8 + rand() * 2.2, a: 0.4 + rand() * 0.5 });
  }
  return drops;
}

function drawDroplets(drops: Droplet[]): void {
  for (const d of drops) {
    const r = Math.ceil(d.r) + 1;
    for (let y = Math.floor(d.y - r); y <= Math.ceil(d.y + r); y++) {
      for (let x = Math.floor(d.x - r); x <= Math.ceil(d.x + r); x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y);
        if (dist >= d.r) continue;
        const a = d.a * (1 - smoothstep(d.r * 0.4, d.r, dist));
        setPx(x, y, mix(getPx(x, y), FOAM, a));
      }
    }
  }
}

// White foam bursting where the whale leaves the water, plus a rolling
// foam ring on the surface around the breach.
function drawFoam(): void {
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
      const edgeFade = 1 - smoothstep(0.55, 1, Math.abs(x - 508) / 185);
      const a = clamp((burst * 0.8 + ring * 0.5) * chop * edgeFade, 0, 0.9);
      if (a > 0.02) setPx(x, y, mix(getPx(x, y), FOAM, a));
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

function drawBirds(): void {
  for (const b of BIRDS) {
    const jx = (rand() - 0.5) * 6;
    const jy = (rand() - 0.5) * 6;
    const cx = b.x + jx;
    const cy = b.y + jy;
    const s = b.s;
    // Two short strokes meeting at the body: a "v" with a slight sweep.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const lx = cx - t * s;
      const ly = cy - t * s * 0.42;
      const rx = cx + t * s;
      const ry = cy - t * s * 0.42;
      const ix = Math.round(lx);
      const iy = Math.round(ly);
      const jx2 = Math.round(rx);
      const jy2 = Math.round(ry);
      if (ix >= 0 && ix < W && iy >= 0 && iy < H) setPx(ix, iy, BIRD);
      if (jx2 >= 0 && jx2 < W && jy2 >= 0 && jy2 < H) setPx(jx2, jy2, BIRD);
      if (ix + 1 < W && iy + 1 < H && ix >= 0 && iy >= 0) setPx(ix, iy + 1, BIRD);
      if (jx2 + 1 < W && jy2 + 1 < H && jx2 >= 0 && jy2 >= 0) setPx(jx2, jy2 + 1, BIRD);
    }
  }
}

// Gentle vignette so the eye stays on the centre.
function drawVignette(): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - 512) / 512, (y - 470) / 512);
      const v = 1 - 0.16 * smoothstep(0.62, 1.05, d);
      const c = getPx(x, y);
      setPx(x, y, [c[0] * v, c[1] * v, c[2] * v]);
    }
  }
}

// ---------------------------------------------------------------------------
// Render + write. Output goes to $MAKEFUN_OUTPUT_DIR/entry.png, or
// /output/entry.png inside the grader's container.
// ---------------------------------------------------------------------------
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  // Base: sky above the horizon, sea below it.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      setPx(x, y, y < HORIZON ? skyColor(x, y) : seaColor(x, y));
    }
  }
  drawSunAndRing();
  drawWhale();
  drawFoam();
  drawDroplets(buildSpray());
  drawBirds();
  drawVignette();
  const png = encodePng(px, W, H);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), png);
  console.log(`wrote ${join(outDir, "entry.png")} (${png.length} bytes)`);
}

main();
