# Ovrilo Desktop

Tauri 2 + React + TypeScript desktop client for [Ovrilo](https://github.com/Ovrilo). Windows-first.

## Prerequisites

- Node.js 22+ and pnpm 10+
- Rust stable (MSVC toolchain on Windows)
- Microsoft C++ Build Tools and WebView2 runtime (Windows) — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- A running `ovrilo-api` (default `http://localhost:5158`; override with `VITE_OVRILO_API_URL`). Locally: start `../ovrilo-infra/local` and `dotnet run --project ../ovrilo-api/src/Ovrilo.Api`.

## Commands

```bash
pnpm install          # install frontend dependencies
pnpm tauri dev        # run the desktop app with hot reload
pnpm dev              # UI only in a browser (in-memory session, no OS credential store)
pnpm typecheck        # TypeScript type check
pnpm test             # unit tests (vitest)
pnpm build            # build frontend bundle
pnpm tauri build      # build installer
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored   # includes a real Credential Manager round trip
```

## API contract

The API client is generated, never hand-written:

1. `pnpm api:sync [path-to-ovrilo-api]` copies `openapi/ovrilo-api.json` into `api/ovrilo-api.json` (default `../ovrilo-api`).
2. `pnpm api:generate` regenerates `src/api/schema.d.ts`.
3. Commit both. CI fails if the generated types do not match the vendored contract; `pnpm typecheck` catches client code that no longer matches it.

The vendored contract's `info.version` is the API contract version this desktop build targets.

## Layout

- `src/api/` — generated schema types and the `openapi-fetch` client.
- `src/auth/` — `SessionManager` (memory access token, single-flight refresh, retry on 401) and credential storage.
- `src/features/` — screens (`auth`, `shell`).
- `src/styles/tokens.css` — design tokens (see `docs/design/DESIGN.md`); do not hard-code colors.
- `src-tauri/src/credentials.rs` — refresh token in Windows Credential Manager.
- `src-tauri/capabilities/` — Tauri permissions; keep least-privilege.

## Architecture rules

- Tauri IPC carries coarse commands and throttled events only; never raw PCM audio (ADR-0002).
- The voice engine (`ovrilo-voice`) is authoritative for voice state; the API is authoritative for identity, channels and messages.
- Tokens never go to web storage (ADR-0011, ADR-0012). The CSP `connect-src` lists the API origin; add the production API origin before release.

See the workspace `AGENTS.md` and `docs/` for ADRs, domain specs and phase plans.
