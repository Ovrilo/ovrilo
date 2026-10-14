// Builds the Windows installer (NSIS) against a specific API server.
// Usage: pnpm release:build <api-url>     e.g. pnpm release:build https://api.example.com
//
// The API origin is compiled into the frontend (VITE_OVRILO_API_URL) and added to the CSP
// connect-src. Only HTTPS is accepted, except http://localhost for local installer testing.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: pnpm release:build <api-url>");
  process.exit(1);
}

let api;
try {
  api = new URL(raw);
} catch {
  console.error(`Not a URL: ${raw}`);
  process.exit(1);
}
const isLocal = api.hostname === "localhost" || api.hostname === "127.0.0.1";
if (api.protocol !== "https:" && !(isLocal && api.protocol === "http:")) {
  console.error("The API URL must use https:// (http:// is allowed only for localhost).");
  process.exit(1);
}

const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const devCsp = tauriConfig.app.security.csp;
// Replace the development API origin with the release one.
const csp = devCsp.replace("http://localhost:5158", api.origin);
if (csp === devCsp && api.origin !== "http://localhost:5158") {
  console.error("Could not find the development API origin in the CSP; update this script.");
  process.exit(1);
}

// Passed as a file: JSON on the Windows command line does not survive shell quoting.
const dir = mkdtempSync(join(tmpdir(), "ovrilo-release-"));
const overrides = join(dir, "tauri.release.conf.json");
writeFileSync(overrides, JSON.stringify({ app: { security: { csp } } }));

console.log(`Building Ovrilo ${tauriConfig.version} for API ${api.origin}`);
const result = spawnSync("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", overrides], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_OVRILO_API_URL: api.origin },
});
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
