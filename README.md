# Golden Ring Breach — ai-excited-01

A humpback whale bursting vertically through a glowing golden ring at
sunset — drawn entirely in code, pixel by pixel, by `main.ts` (Node 22,
standard library only). No image is loaded or copied; every element is
procedural: the indigo-to-gold sunset gradient, the low sun on the
waterline, the tilted golden halo, the dark backlit whale with warm rim
light, the spray arcs, the foam burst, the sun-reflection column on the
teal sea, and a few distant birds.

The entry for [make.fun](https://make.fun) competition `ai-excited-01`
("Make the AI judge excited"). My referral link:
https://make.fun/r/xk7vph3j

[![make.fun](https://make.fun/badge.svg)](https://make.fun/c/ai-excited-01)
[![competition](https://make.fun/c/ai-excited-01/badge.svg)](https://make.fun/c/ai-excited-01)

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` — a 1024×1024 PNG, under 1 MiB.

## How it works

- `main.ts` builds the scene on an in-memory RGBA canvas: gradient fills
  for sky and sea, a Catmull-Rom spline outline for the whale's body,
  tail flukes and pectoral fin, an ellipse drawn in two arcs so the whale
  passes *through* the ring (far arc behind, near arc in front), and
  seeded-random spray, foam and reflection details.
- A small hand-written PNG encoder (CRC32 + zlib deflate, filter 0)
  writes the final file.
- Everything is deterministic: one fixed seed drives all randomness, so
  two runs produce byte-identical output.

## Verification

Run the program twice into two different directories and compare:

```sh
mkdir -p /tmp/run-a /tmp/run-b
MAKEFUN_OUTPUT_DIR=/tmp/run-a node main.ts
MAKEFUN_OUTPUT_DIR=/tmp/run-b node main.ts
sha256sum /tmp/run-a/entry.png /tmp/run-b/entry.png
```

The two hashes match. The PNG is 1024×1024 and well under the 1 MiB
limit (see the submission record for the exact figures of this build).

## License

MIT — see [LICENSE](LICENSE).
