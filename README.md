# Ovrilo Desktop

Tauri 2 + React + TypeScript desktop client for [Ovrilo](https://github.com/Ovrilo). Windows-first.

## Prerequisites

- Node.js 22+ and pnpm 10+
- Rust stable (MSVC toolchain on Windows)
- Microsoft C++ Build Tools and WebView2 runtime (Windows) — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Commands

```bash
pnpm install          # install frontend dependencies
pnpm tauri dev        # run the desktop app with hot reload
pnpm typecheck        # TypeScript type check
pnpm build            # build frontend bundle
pnpm tauri build      # build installer
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## Layout

- `src/` — React UI. Design tokens live in `src/styles/tokens.css` (see `docs/design/DESIGN.md`).
- `src-tauri/` — Rust host: window lifecycle, Tauri commands, future `ovrilo-voice` integration.
- `src-tauri/capabilities/` — Tauri permissions; keep least-privilege.

## Architecture rules

- Tauri IPC carries coarse commands and throttled events only; never raw PCM audio (ADR-0002).
- The voice engine (`ovrilo-voice`) is authoritative for voice state; the API is authoritative for identity, channels and messages.
- Do not store tokens in web storage; follow ADR-0011/ADR-0012.

See the workspace `AGENTS.md` and `docs/` for ADRs, domain specs and phase plans.
