import { describe, expect, it } from "vitest";

import { formatStats, summarizeInbound } from "./streamStats";

const report = (bytes: number, extra: Record<string, unknown> = {}): [string, unknown][] => [
  ["IT01V", { type: "inbound-rtp", kind: "video", frameWidth: 1920, frameHeight: 1080, framesPerSecond: 29.7, bytesReceived: bytes, codecId: "C1", ...extra }],
  ["IT01A", { type: "inbound-rtp", kind: "audio", bytesReceived: 999 }],
  ["C1", { type: "codec", mimeType: "video/H264" }],
];

describe("summarizeInbound", () => {
  it("reports size, frame rate, codec and the bitrate between samples", () => {
    const first = summarizeInbound(report(1_000_000), null, 10_000)!;
    expect(first).toMatchObject({ width: 1920, height: 1080, fps: 30, kbps: 0, codec: "H264" });

    const second = summarizeInbound(report(1_500_000), first, 12_000)!;
    expect(second.kbps).toBe(2000);
    expect(formatStats(second)).toBe("1920×1080 · 30 fps · 2.0 Mbps · H264");
  });

  it("waits for decoded frames", () => {
    expect(summarizeInbound(report(0, { frameWidth: undefined }), null, 0)).toBeNull();
    expect(summarizeInbound([], null, 0)).toBeNull();
  });
});
