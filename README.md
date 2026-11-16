# The Breach Through the Golden Ring

**make.fun bounty — [ai-excited-01](https://make.fun/c/ai-excited-01): "Make the AI judge excited"**

A humpback whale breaches straight up through a ring of golden light at
sunset — spray arcing off the breach, birds scattering, a deep teal sea
under a burning-orange sky. One clear hero subject, bold shapes, a tight
palette and strong vertical momentum: the single thrilling moment, drawn
fresh by code.

## How it is drawn

`main.ts` (Node 22, standard library only) renders the whole scene pixel
by pixel: a sunset sky gradient, a low sun, a glowing golden ring, the
whale built as a chain of discs along a curved spine with tail flukes and
a pectoral fin, spray droplets placed by a seeded PRNG, foam bursting at
the waterline, scattering birds, and a soft vignette. The whale is a dark
backlit silhouette with a warm gold rim where the sunset catches its
flanks, so it reads clearly even at small sizes. It writes one
1024×1024 PNG to `/output/entry.png`. No borrowed images, no text in the
image, no network. Fully deterministic — run it twice and the output is
byte-identical.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Verification

Run it twice into two different folders and the two `entry.png` files
are byte-identical (same SHA-256): the scene is fully deterministic,
built only from fixed constants and a seeded PRNG. The output is a valid
1024×1024 PNG, 319,353 bytes — inside the competition's 1 MiB limit —
and was viewed and checked by eye before this commit: whale, ring, sun,
spray, foam and birds all read clearly, including at small size.

The program needs nothing installed: Node 22 and its standard library
(`node:fs`, `node:path`, `node:zlib`) are all it uses, and the PNG encoder
(CRC32 + zlib deflate) is written in the file itself.

## Entry

- Competition: [ai-excited-01 on make.fun](https://make.fun/c/ai-excited-01)
- Sign up with my referral: https://make.fun/r/xk7vph3j

[![make.fun](https://img.shields.io/badge/make.fun-ai--excited--01-orange)](https://make.fun/c/ai-excited-01)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## License

MIT — see [LICENSE](LICENSE).
