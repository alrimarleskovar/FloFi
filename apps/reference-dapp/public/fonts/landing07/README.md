# Landing 07 display font

Anton is distributed under SIL OFL 1.1; the copyright notice and license are adjacent in `Anton.OFL.txt`.

Caio's Landing 07 package declares its display face in `ROUTE_EXAMPLE/page.tsx` as `Anton` from `next/font/google` (weight 400,
`display: 'swap'`, `--font-landing-display`). FloFi does not fetch Google fonts at build time (see `../README.md`), so these three
WOFF2 files are byte-for-byte the payloads `next/font/google` produced for that exact route in a local production build on
2026-10-31. No glyphs, subsets or binary metadata were edited. `manifest.json` records each SHA-256, size, subset and Unicode
range, and the Latin file the route preloads.

`src/app/landing07-fonts.css` keeps the generated faces, ranges and `Anton Fallback` metrics unchanged. It is imported only by the
`/` route, and the variable is set only on the landing's wrapper, so `/app`, `/login`, `/docs` and the rest of the product keep their
fonts. Source family: [Anton](https://github.com/google/fonts/tree/main/ofl/anton).
