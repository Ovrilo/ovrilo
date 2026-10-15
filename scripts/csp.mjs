// Content Security Policy for release builds, derived from the development CSP in tauri.conf.json.
//
// The realtime hub (SignalR) uses WebSockets. Chromium/WebView2 does not let an https:// connect-src
// source cover wss:// (nor http:// cover ws://), so the API origin must be listed for both schemes,
// or the hub cannot connect and presence, live messages and read sync silently stop working.

/** Development origins in tauri.conf.json that release builds replace. */
export const DEV_ORIGINS = {
  api: "http://localhost:5158",
  apiSocket: "ws://localhost:5158",
  media: "http://127.0.0.1:9000",
};

/** WebSocket origin of an http(s) origin: https → wss, http → ws. */
export function socketOrigin(origin) {
  return origin.replace(/^http/, "ws");
}

/** Returns the release CSP, or throws when the development CSP no longer lists an expected origin. */
export function releaseCsp(devCsp, apiOrigin, mediaOrigin) {
  const replacements = [
    [DEV_ORIGINS.api, apiOrigin],
    [DEV_ORIGINS.apiSocket, socketOrigin(apiOrigin)],
    [DEV_ORIGINS.media, mediaOrigin],
  ];
  let csp = devCsp;
  for (const [from, to] of replacements) {
    if (!csp.includes(` ${from}`)) {
      throw new Error(`Could not find the development origin ${from} in the CSP; update scripts/csp.mjs.`);
    }
    csp = csp.replace(` ${from}`, ` ${to}`);
  }
  return csp;
}
