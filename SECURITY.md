# Security model — tracker

A LAN-only player for a filesystem tracker-module collection. Durable state is
**one SQLite cache** (`TRACKER_DB_PATH`: a path index of the collection plus
libopenmpt-parsed metadata and per-tune favourite/play-count stats) on a
restic-backed bind mount. The modules themselves live on a **NAS mount**
(`TRACKER_ROOT`, mounted **read-write** so the app can rename/move files). The
DB is a cache, not the source of truth — losing it only costs a rescan. The
binary talks to no upstreams.

## Trust boundaries & identity

There is **no per-user state** — the collection is a single shared library — so
the binary runs no login of its own. `/api/*` access is gated by one of two
modes (`backend/src/auth.rs`):

1. **oauth2-proxy forward-auth** (the gated-host deploy): the app asserts that
   the edge vouched for the request via `X-Auth-Request-User`, returning 401 if
   the header is absent (defence in depth; the edge is the real gate). The
   header is PII and is **never logged**.
2. **Open mode** (`TRACKER_OPEN=1`, or `DEV_AUTH=1` for local work): the
   forward-auth assertion is skipped. This is the intended LAN-only deployment
   (no oauth2-proxy in front) — security then relies entirely on the host being
   **egress/ingress restricted to the LAN** (`../raspi/tasks/network_restrict.py`
   + internal DNS). **Do not expose an open-mode instance publicly.**

## Unauthenticated surface

- **`GET /status`** is intentionally auth-free (service name, version, a DB
  health boolean, track count, the configured root path string, and live scan
  progress — no file contents) so gatus can probe liveness. Served on a Traefik
  monitor router that bypasses oauth2-proxy; everything else on a gated host
  stays gated.

## Input surface

- **All SQL is parameterized** (`rusqlite params!`); no user input is
  interpolated into a query.
- **File serving** (`/api/file/{hash}`) resolves the stored `rel_path` for a
  hash, then **canonicalises and prefix-checks it against `TRACKER_ROOT`**,
  rejecting anything that escapes the root or isn't a regular file.
- **Rename / move** (`/api/rename`) is the one write path into the collection.
  Destination segments are validated as **clean single segments** (non-empty,
  not `.`/`..`, no `/`,`\`,NUL), the filename must keep a recognised **module
  extension**, the source is canonicalised under the root, and the move
  **refuses to overwrite** an existing file (409). The collection mount is
  read-write by necessity, but the blast radius is the modules directory only.
- **Static/SPA serving** resolves the path and rejects anything escaping
  `STATIC_DIR` after canonicalisation; unmatched routes return the SPA shell,
  never an arbitrary file.

## Content (module files are untrusted bytes)

- The backend is **pure Rust and never parses module bytes** — it only indexes
  paths and serves files. All decoding/playback and metadata extraction run in
  **libopenmpt compiled to WASM, inside an AudioWorklet in the browser**. A
  malformed or malicious module can therefore only affect the sandboxed WASM in
  the user's own tab, not the server.
- Client-posted metadata (`POST /api/meta`) and pattern-cell/title strings are
  treated as **text** (rendered via Svelte text interpolation, never `{@html}`),
  so a crafted title can't inject markup.
- **CSP** is set in-code on every response: same-origin, plus
  `'wasm-unsafe-eval'` and `worker-src blob:` (required for the WASM player) and
  the build-hashed bootstrap script (no `'unsafe-inline'`). HSTS /
  X-Frame-Options / X-Content-Type-Options are Traefik's job.

## Hardening

- **Container**: `scratch` base (no shell/userland), non-root (`USER 1000`),
  LAN-only egress restriction, small `MemoryMax`. The only writable paths are
  `/data` (the SQLite cache) and the mounted collection share.
- **Fail closed**: the binary refuses to boot without a valid `TRACKER_ROOT`
  (must be an existing directory).
- **Type sharing is manual** (`frontend/src/lib/api.ts` mirrors the Rust
  structs) — no codegen attack surface.

## Reporting

Personal single-user project. Open an issue, or just fix it.
