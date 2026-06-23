# tracker

A FastTracker 2-style player for a filesystem collection of tracker modules.
Point it at a directory tree of `group/artist/song.ext` and it scans, indexes,
and (soon) plays them — MOD, XM, S3M, IT and the obscure legacy zoo — via
libopenmpt compiled to WebAssembly, with a pixel-perfect FT2 interface.

The filesystem is the database: no sidecar metadata files, so you can reorganise
freely with ordinary tools. Parsed metadata is cached by content hash, so it
follows a file when you move it.

## Quick start (dev)

```sh
# backend (:3010)
cd backend
cp .env.example .env          # set TRACKER_ROOT to your collection
cargo run

# frontend (:5173, proxies /api → :3010)
cd frontend
yarn install
yarn dev
```

## Status

Backend (scanner + SQLite cache + JSON API) and the library browser (group /
artist / format facets, filter, rescan) are working and tested against a real
~3500-module collection. Playback + the FT2 UI (scopes, live pattern view,
sample tab with keyboard jamming) are next — see `CLAUDE.md` for the design and
the plan file for the full roadmap.

Part of eetu's homebrew family — Rust (axum) backend embedding a SvelteKit SPA,
deployed to the Raspberry Pi via `../raspi`.
