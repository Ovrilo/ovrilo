# Ovrilo Desktop

Tauri 2 + React + TypeScript desktop client for [Ovrilo](https://github.com/Ovrilo). Windows-first.

## Prerequisites

- Node.js 22+ and pnpm 10+
- Rust stable (MSVC toolchain on Windows)
- Microsoft C++ Build Tools and WebView2 runtime (Windows) — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- A running `ovrilo-api` (default `http://localhost:5158`; override with `VITE_OVRILO_API_URL`). Locally: start `../ovrilo-infra/local` and `dotnet run --project ../ovrilo-api/src/Ovrilo.Api`. Avatars and icons load straight from its object storage (locally RustFS on `http://127.0.0.1:9000`).

## Commands

```bash
pnpm install          # install frontend dependencies
pnpm tauri dev        # run the desktop app with hot reload
pnpm dev              # UI only in a browser (in-memory session, no OS credential store)
pnpm typecheck        # TypeScript type check
pnpm test             # unit tests (vitest)
pnpm build            # build frontend bundle
pnpm release:build <api-url> <media-url>   # Windows installer (NSIS), e.g. https://api.example.com https://media.example.com
# Rust: run inside src-tauri/ so .cargo/config.toml (static CRT, git CLI fetch) applies
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test -- --include-ignored   # includes a real Credential Manager round trip
```

## Release builds

`pnpm release:build https://api.<domain> https://media.<domain>` compiles the API origin into the frontend (`VITE_OVRILO_API_URL`), replaces the development API and storage origins in the CSP and produces `src-tauri/target/release/bundle/nsis/Ovrilo_<version>_x64-setup.exe`. The installer is per-user (no admin rights) and unsigned for now, so Windows SmartScreen shows a warning ("More info" → "Run anyway"). Only `https://` URLs are accepted, plus `http://localhost` for local testing. The release workflow takes them from `vars.OVRILO_API_URL` and `vars.OVRILO_MEDIA_URL`.

Tagged releases (`release.yml`) restore a release-profile Rust cache that `release-cache.yml` keeps warm on `main` (after host changes and weekly), so a release recompiles only what changed instead of Tauri and LiveKit/WebRTC from scratch. The release profile uses thin LTO for the same reason.

`ovrilo-voice` is a private Git dependency pinned by revision; fetching it uses the git CLI with your GitHub credentials (CI uses a read-only deploy key, `OVRILO_VOICE_DEPLOY_KEY`).

## API contract

The API client is generated, never hand-written:

1. `pnpm api:sync [path-to-ovrilo-api]` copies `openapi/ovrilo-api.json` into `api/ovrilo-api.json` (default `../ovrilo-api`).
2. `pnpm api:generate` regenerates `src/api/schema.d.ts`.
3. Commit both. CI fails if the generated types do not match the vendored contract; `pnpm typecheck` catches client code that no longer matches it.

The vendored contract's `info.version` is the API contract version this desktop build targets.

## Layout

- `src/api/` — generated schema types and the `openapi-fetch` client.
- `src/auth/` — `SessionManager` (memory access token, single-flight refresh, retry on 401) and credential storage.
- `src/media/` — images by asset ID (`MediaCache`: batched download URLs, one download per asset, first-frame stills so GIFs play only on hover) and uploads (`uploadImage`: still images are cropped and shrunk to 512 px first; GIFs and animated WebP go up unchanged).
- `src/features/` — screens (`auth`, `shell`, `voice`, `settings`); `voice/quality.ts` turns engine stats into the connection rating.
- `src/styles/tokens.css` — design tokens (see `docs/design/DESIGN.md`); do not hard-code colors.
- `src-tauri/src/credentials.rs` — refresh token in Windows Credential Manager.
- `src-tauri/src/voice.rs` — voice engine host and IPC; `stats_log.rs` writes `voice-stats.csv` to the app log directory; `tray.rs` keeps Ovrilo (and the call) running in the tray when the window is closed.
- `src-tauri/capabilities/` — Tauri permissions; keep least-privilege.

## Architecture rules

- Tauri IPC carries coarse commands and throttled events only; never raw PCM audio (ADR-0002).
- The voice engine (`ovrilo-voice`) is authoritative for voice state; the API is authoritative for identity, channels and messages.
- Tokens never go to web storage (ADR-0011, ADR-0012). The CSP `connect-src` lists the development API and storage origins; `pnpm release:build` swaps in the release ones. Image bytes come from storage via short-lived presigned URLs and are shown as `blob:` URLs; the bearer token is never sent to storage.

See the workspace `AGENTS.md` and `docs/` for ADRs, domain specs and phase plans.
