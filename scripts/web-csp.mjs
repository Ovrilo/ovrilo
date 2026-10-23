// Prints the Content Security Policy of the browser client (ADR-0019) for its web server.
// Usage: node scripts/web-csp.mjs <api-url> <media-url> <voice-url>
//
// Same sources as the desktop release CSP (scripts/csp.mjs), minus the Tauri-only ones (ipc:, asset:),
// plus what a web page needs that a webview gets from Tauri: media from blob: and protection against framing.
import { readFileSync } from "node:fs";

import { releaseCsp } from "./csp.mjs";

const [api, media, voice] = process.argv.slice(2);
if (!api || !media || !voice) {
  console.error("Usage: node scripts/web-csp.mjs <api-url> <media-url> <voice-url>");
  process.exit(1);
}

const origin = (raw) => new URL(raw).origin;
const tauriConfig = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const csp = releaseCsp(tauriConfig.app.security.csp, origin(api), origin(media), origin(voice))
  .replace(" ipc: http://ipc.localhost", "")
  .replace(" asset:", "");

for (const tauriOnly of ["ipc:", "asset:", "ipc.localhost"]) {
  if (csp.includes(tauriOnly)) {
    console.error(`The web CSP still contains ${tauriOnly}; update scripts/web-csp.mjs.`);
    process.exit(1);
  }
}

console.log(`${csp}; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);
