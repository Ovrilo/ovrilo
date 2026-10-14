// Builds the Windows installer (NSIS) against a specific API server and its object storage.
// Usage: pnpm release:build <api-url> <media-url>
//   e.g. pnpm release:build https://api.example.com https://media.example.com
//
// The API origin is compiled into the frontend (VITE_OVRILO_API_URL); both origins replace the
// development ones in the CSP connect-src (images are read and uploaded with presigned storage URLs).
// Only HTTPS is accepted, except http://localhost / 127.0.0.1 for local installer testing.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [rawApi, rawMedia] = process.argv.slice(2);
if (!rawApi || !rawMedia) {
  console.error("Usage: pnpm release:build <api-url> <media-url>");
  process.exit(1);
}

function parseOrigin(raw, what) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`Not a URL: ${raw}`);
    process.exit(1);
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    console.error(`The ${what} URL must use https:// (http:// is allowed only for localhost).`);
    process.exit(1);
  }
  return url;
}

const api = parseOrigin(rawApi, "API");
const media = parseOrigin(rawMedia, "media");

const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const devCsp = tauriConfig.app.security.csp;
// Replace the development origins with the release ones.
const devOrigins = { api: "http://localhost:5158", media: "http://127.0.0.1:9000" };
for (const origin of Object.values(devOrigins)) {
  if (!devCsp.includes(` ${origin}`)) {
    console.error(`Could not find the development origin ${origin} in the CSP; update this script.`);
    process.exit(1);
  }
}
const csp = devCsp.replace(` ${devOrigins.api}`, ` ${api.origin}`).replace(` ${devOrigins.media}`, ` ${media.origin}`);

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

console.log(`Building Ovrilo ${tauriConfig.version} for API ${api.origin} and media ${media.origin}`);
const result = spawnSync("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", overrides], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_OVRILO_API_URL: api.origin },
});
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
