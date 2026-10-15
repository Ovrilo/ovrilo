// Builds the Windows installer (NSIS) against a specific API server and its object storage.
// Usage: pnpm release:build <api-url> <media-url> [voice-url]
//   e.g. pnpm release:build https://api.example.com https://media.example.com wss://voice.example.com
//
// The API origin is compiled into the frontend (VITE_OVRILO_API_URL); the API (https and wss, for the
// realtime hub), storage and voice-server origins replace the development ones in the CSP connect-src.
// The voice server (LiveKit) is needed only for watching screen shares; without it that is unavailable.
// Only HTTPS/WSS are accepted, except localhost / 127.0.0.1 for local installer testing.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { releaseCsp } from "./csp.mjs";

const [rawApi, rawMedia, rawVoice] = process.argv.slice(2);
if (!rawApi || !rawMedia) {
  console.error("Usage: pnpm release:build <api-url> <media-url> [voice-url]");
  process.exit(1);
}

function parseOrigin(raw, what, secure = "https:", local = "http:") {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`Not a URL: ${raw}`);
    process.exit(1);
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== secure && !(isLocal && url.protocol === local)) {
    console.error(`The ${what} URL must use ${secure}// (${local}// is allowed only for localhost).`);
    process.exit(1);
  }
  return url;
}

const api = parseOrigin(rawApi, "API");
const media = parseOrigin(rawMedia, "media");
const voice = rawVoice ? parseOrigin(rawVoice, "voice server", "wss:", "ws:") : null;

const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
let csp;
try {
  // Development API (http and ws) and storage origins → release ones; see scripts/csp.mjs.
  csp = releaseCsp(tauriConfig.app.security.csp, api.origin, media.origin, voice?.origin);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Passed as a file: JSON on the Windows command line does not survive shell quoting.
const dir = mkdtempSync(join(tmpdir(), "ovrilo-release-"));
const overrides = join(dir, "tauri.release.conf.json");
// Updater artifacts (.sig) need the private signing key, available only in the release workflow
// (TAURI_SIGNING_PRIVATE_KEY). Local builds produce an unsigned-for-update installer instead.
const signUpdates = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
if (!signUpdates) console.warn("TAURI_SIGNING_PRIVATE_KEY not set: building without updater signature.");
writeFileSync(
  overrides,
  JSON.stringify({ app: { security: { csp } }, bundle: { createUpdaterArtifacts: signUpdates } }),
);

console.log(
  `Building Ovrilo ${tauriConfig.version} for API ${api.origin}, media ${media.origin}` +
    (voice ? ` and voice server ${voice.origin}` : " (no voice server: screen shares cannot be watched)"),
);
const result = spawnSync("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", overrides], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_OVRILO_API_URL: api.origin },
});
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
