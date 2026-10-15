// Content Security Policy for release builds, derived from the development CSP in tauri.conf.json.
//
// The realtime hub (SignalR) uses WebSockets. Chromium/WebView2 does not let an https:// connect-src
// source cover wss:// (nor http:// cover ws://), so the API origin must be listed for both schemes,
// or the hub cannot connect and presence, live messages and read sync silently stop working.
//
// The webview also connects to the voice server (LiveKit) to watch screen shares (ADR-0017); the
// voice engine does not need CSP. Release builds without a voice URL leave it out, and watching
// screen shares is then unavailable.

/** Development origins in tauri.conf.json that release builds replace. */
export const DEV_ORIGINS = {
  api: "http://localhost:5158",
  apiSocket: "ws://localhost:5158",
  media: "http://127.0.0.1:9000",
  voice: "ws://127.0.0.1:7880",
  voiceHttp: "http://127.0.0.1:7880",
};

/** WebSocket origin of an http(s) origin: https → wss, http → ws. */
export function socketOrigin(origin) {
  return origin.replace(/^http/, "ws");
}

/** HTTP origin of a ws(s) origin: wss → https, ws → http. */
export function httpOrigin(origin) {
  return origin.replace(/^ws/, "http");
}

/**
 * Returns the release CSP, or throws when the development CSP no longer lists an expected origin.
 * `voiceOrigin` is the LiveKit server (wss://…); without it the voice origins are removed.
 */
export function releaseCsp(devCsp, apiOrigin, mediaOrigin, voiceOrigin) {
  const replacements = [
    [DEV_ORIGINS.api, apiOrigin],
    [DEV_ORIGINS.apiSocket, socketOrigin(apiOrigin)],
    [DEV_ORIGINS.media, mediaOrigin],
    [DEV_ORIGINS.voice, voiceOrigin ?? ""],
    [DEV_ORIGINS.voiceHttp, voiceOrigin ? httpOrigin(voiceOrigin) : ""],
  ];
  let csp = devCsp;
  for (const [from, to] of replacements) {
    if (!csp.includes(` ${from}`)) {
      throw new Error(`Could not find the development origin ${from} in the CSP; update scripts/csp.mjs.`);
    }
    csp = csp.replace(` ${from}`, to ? ` ${to}` : "");
  }
  return csp;
}
