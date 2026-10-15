import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEV_ORIGINS, releaseCsp } from "./csp.mjs";

const devCsp = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app.security.csp;
const connectSrc = (csp) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src ")).split(/\s+/);

describe("CSP", () => {
  it("lets the development build reach the API over HTTP and WebSockets", () => {
    expect(connectSrc(devCsp)).toEqual(expect.arrayContaining([DEV_ORIGINS.api, DEV_ORIGINS.apiSocket, DEV_ORIGINS.media]));
  });

  it("swaps in the release API (https and wss) and storage origins", () => {
    const sources = connectSrc(releaseCsp(devCsp, "https://api.example.com", "https://media.example.com"));

    expect(sources).toEqual(expect.arrayContaining(["https://api.example.com", "wss://api.example.com", "https://media.example.com"]));
    expect(sources.join(" ")).not.toMatch(/\/\/localhost|127\.0\.0\.1:9000/);
  });

  it("fails loudly when the development CSP changed shape", () => {
    expect(() => releaseCsp("default-src 'self'", "https://api.example.com", "https://media.example.com")).toThrow(/development origin/);
  });
});
