# syntax=docker/dockerfile:1

# --- Cross-compilation helper ---
FROM --platform=$BUILDPLATFORM tonistiigi/xx AS xx

# --- Stage 1: Build frontend (native, output is platform-independent) ---
#
# Vendored yarn (no corepack) — the binary is committed under
# frontend/.yarn/releases and pinned by .yarnrc.yml's `yarnPath`, so the build
# is independent of the base image's bundled yarn / node's corepack shims.
FROM --platform=$BUILDPLATFORM node:26-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/yarn.lock frontend/.yarnrc.yml ./
COPY frontend/.yarn/releases ./.yarn/releases
RUN node .yarn/releases/yarn-*.cjs install --immutable --network-timeout 1000000
COPY frontend/ .
RUN node .yarn/releases/yarn-*.cjs build

# --- Stage 2: Build workspace dependencies (native, cross-compiled) ---
#
# Compiles all transitive deps using stub sources so the dep-build cache stays
# warm across source changes. e2e is a test-only crate (never shipped), so it
# just needs a stub lib to satisfy workspace parsing — we build only the backend.
FROM --platform=$BUILDPLATFORM rust:1-alpine AS workspace-deps
COPY --from=xx / /
RUN apk add --no-cache clang lld musl-dev curl
ARG TARGETPLATFORM
RUN xx-apk add --no-cache musl-dev gcc
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY e2e/Cargo.toml e2e/Cargo.toml
RUN mkdir -p backend/src e2e/src \
    && printf 'fn main() {}\n' > backend/src/main.rs \
    && : > backend/src/lib.rs \
    && : > e2e/src/lib.rs \
    && xx-cargo build --release -p tracker-backend

# --- Stage 3: Build tracker-backend ---
FROM workspace-deps AS backend-build
ARG TARGETPLATFORM
COPY backend/src ./backend/src
# `touch` so cargo notices the stub→real source swap.
RUN touch backend/src/main.rs backend/src/lib.rs \
    && xx-cargo build --release -p tracker-backend \
    && cp target/*/release/tracker-backend /tracker-backend

# --- Stage 4: Runtime (scratch + static musl binary + SPA + certs) ---
FROM scratch AS runner
WORKDIR /app
LABEL org.opencontainers.image.description="tracker — FastTracker 2-style player for a filesystem module collection"
LABEL org.opencontainers.image.source="https://github.com/eetu/tracker"

COPY --from=backend-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=backend-build /tracker-backend ./tracker-backend
COPY --from=frontend-build /app/dist ./dist

# Sensible runtime defaults — override via -e at run time. TRACKER_ROOT has no
# default (it's required and validated at boot: the modules live on a NAS mount).
ENV STATIC_DIR=./dist
ENV TRACKER_DB_PATH=/data/tracker.db
ENV TRACKER_BIND=0.0.0.0:3010

USER 1000

EXPOSE 3010

CMD ["./tracker-backend"]
