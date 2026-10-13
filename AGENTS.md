# ovrilo (desktop) — Agent Instructions

Read the workspace `../AGENTS.md` first; it overrides nothing here but applies in full. **Never commit, stage or push without explicit user authorization.**

- Stack: Tauri 2, React, TypeScript, Vite, pnpm. Windows-first.
- Before UI work read `docs/design/DESIGN.md`, the active phase plan and relevant ADRs (0002, 0010, 0011, 0012).
- Tauri IPC: coarse commands and throttled events only; no PCM audio. Keep capabilities least-privilege.
- State ownership: voice runtime state in Rust (`ovrilo-voice`), server data via API (TanStack Query, proposed), UI-only state in React (Zustand, proposed). No competing authoritative copies.
- Generate API clients from `ovrilo-api` OpenAPI; do not hand-copy DTOs.
- Use tokens from `src/styles/tokens.css`; do not hard-code colors.
- Validate: `pnpm typecheck`, `pnpm build`, `cargo fmt --check` and `cargo clippy -- -D warnings` in `src-tauri/`.
