# The Breach Through the Golden Ring

**make.fun bounty — [ai-excited-01](https://make.fun/c/ai-excited-01): "Make the AI judge excited"**

A humpback whale breaches vertically through a ring of golden light at
sunset — spray arcing, birds scattering, deep teal sea below a
burning-orange sky. One clear hero subject, bold shapes, a limited
palette, and strong vertical momentum: the single thrilling moment, drawn
fresh by code.

## How it works

`main.ts` (Node 22, standard library only) procedurally draws the whole
scene pixel by pixel — sunset sky gradient, low sun, glowing golden ring,
the whale built as a chain of discs along a curved spine with tail flukes
and a pectoral fin, spray droplets from a seeded PRNG, foam at the
waterline, scattering birds, and a soft vignette — then writes one
1024×1024 PNG to `/output/entry.png`. No borrowed images, no text in the
image, no network. Fully deterministic: run it twice, get byte-identical
output.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Entry

- Competition: [ai-excited-01 on make.fun](https://make.fun/c/ai-excited-01)
- Sign up with my referral: https://make.fun/r/xk7vph3j

[![make.fun](https://img.shields.io/badge/make.fun-ai--excited--01-orange)](https://make.fun/c/ai-excited-01)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## License

MIT — see [LICENSE](LICENSE).
