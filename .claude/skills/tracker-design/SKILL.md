---
name: tracker-design
description: The per-app visual identity for tracker — a FastTracker 2 / Amiga-demoscene look layered on the homebrew family identity. Use when building or restyling any UI in this repo (library browser, player overlay, pattern grid, samples tab, transport, empty/error states). Covers the glyph, wordmark, layout, type, and voice deltas specific to this app.
---

# tracker-design

The per-app identity for **tracker**, a FastTracker 2-style player. The product
*is* a retro tracker, so the surface leans into that — an Amiga/DOS-demoscene
look rather than the family's neutral chrome.

> **Tokens.** halo-design is adopted: the canonical `--halo-*` palette lives in
> `src/lib/styles/halo.css` (imported globally in `+layout.svelte`), with two
> deviations from the verbatim file — dark/light flips on `data-theme` (not
> `@media`, since tracker has an explicit light/dark/auto switch and is
> dark-first) and no Google-Fonts `@import` (Inter is self-hosted; CSP forbids
> the CDN). `+layout.svelte` then maps the app tokens (`--bg/--panel/--accent/…`
> + the `--surface-*` player set) onto `--halo-*`, so components consume the
> local tokens and both themes follow automatically. Never hard-code hex — use a
> token (`var(--halo-error)` for errors, etc.).

## 1. Glyph

A **tracker pattern with the playing row lit**: a 3×3 grid of rounded cells, the
**middle row in the accent amber** over a faint accent centerline band, the
other rows in muted slate — i.e. the current row glowing as the pattern scrolls
under the playhead (ties to the `ScanLine` centerline-toggle metaphor). Accent is
the halo amber `#f78f08`. Sources:
`static/favicon.svg` (rounded tile) + `static/icon-maskable-512.png` (safe-zone
grid); `apple-touch-icon.png` / `icon-192.png` / `icon-512.png` are rasterised
from the same SVG with `rsvg-convert`.

## 2. Wordmark

Text: **`tracker`** (one word, lowercase), in the retro face
(`--font-retro` = Amiga **TopazPlus**), coloured `--accent` (the halo amber
`#f78f08`). It's the sole header brand — no tagline.

## 3. Layout & type

A **two-tier font split** is the defining rule:

- **Retro (`--font-retro` / `--font-mono-retro`, TopazPlus 8×16, native 16px)**
  on the *brand* and the *player surfaces* — the pattern grid, sample list,
  ord/pat/row + time readouts, and the now-playing mini-player. These are the
  "FT2 screen".
- **Inter (body)** for the dense library list and toolbar — TopazPlus is
  unreadable at list density, and mixing them *within* one surface looks off
  (keep a surface wholly one or the other).

Surfaces:

- **Library** — full-width, grouped into expanding **cards** (group/artist/
  format facets, a filter, a favourites toggle, a sort), rendered through a
  **virtualized list** (TanStack Virtual, fixed row heights — see
  `+page.svelte`). Rename/move is a centered **modal** (keeps rows fixed-height).
- **Player overlay** — full-screen, tabs: pattern / samples / **ball** (a
  pixelated Amiga Boing Ball visualizer reacting to channel VU). A fixed
  transport bar floats over the bottom (also the list's mini-player).
- **Pattern view** — locked fixed-centerline (pattern scrolls under a lit line,
  per-channel vertical VU) or free-scroll, toggled by the `ScanLine` button;
  channel columns snap one-at-a-time, scrollbars hidden.

## 4. Voice & icons

Demoscene-retro but quiet: **lowercase**, no exclamation marks, no emoji. Icons
are **Lucide**, CSS-squared (square caps/joins, thicker stroke) so they sit with
the pixel fonts — never Material Icons. Empty/error states stay one plain line
(e.g. "No modules indexed yet — try rescan."). The numbers (row/pattern/time,
play counts) and the moving scope/ball do the talking.

## Backlog visual ideas

A retro playback visualizer mode (the Boing Ball is the first); FT2 beveled-grey
panel chrome + DOS palette as an optional theme. See the root `CLAUDE.md`
roadmap.
