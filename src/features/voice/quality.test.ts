import { describe, expect, it } from "vitest";

import { summarize, type VoiceStats } from "./quality";

const base: VoiceStats = {
  roundTripMs: 40,
  inboundPacketsReceived: 0,
  inboundPacketsLost: 0,
  inboundJitterMs: 5,
  inboundConcealedMs: 0,
  outboundPacketsLost: 0,
  playoutBufferedMs: 40,
  playoutUnderruns: 0,
  playoutSkippedMs: 0,
  captureOverflowMs: 0,
  remoteFramesDropped: 0,
  microphoneFramesDropped: 0,
};

/** One sample per second with 50 packets/s received. */
function series(seconds: number, change: (s: VoiceStats, i: number) => Partial<VoiceStats> = () => ({})) {
  return Array.from({ length: seconds + 1 }, (_, i) => ({
    ...base,
    inboundPacketsReceived: i * 50,
    ...change(base, i),
  }));
}

describe("summarize", () => {
  it("is unknown without enough samples", () => {
    expect(summarize([]).quality).toBe("unknown");
    expect(summarize([base]).quality).toBe("unknown");
  });

  it("rates a clean connection good", () => {
    const summary = summarize(series(10));
    expect(summary.quality).toBe("good");
    expect(summary.issues).toEqual([]);
    expect(summary.lossPercent).toBe(0);
  });

  it("rates moderate loss fair and heavy loss poor", () => {
    // 10 s × 50 received; 10 lost ≈ 2 %.
    expect(summarize(series(10, (_, i) => ({ inboundPacketsLost: i }))).quality).toBe("fair");
    // 50 lost ≈ 9 %.
    const heavy = summarize(series(10, (_, i) => ({ inboundPacketsLost: i * 5 })));
    expect(heavy.quality).toBe("poor");
    expect(heavy.issues[0]).toMatch(/packet loss/);
  });

  it("flags robotic audio from concealment per second", () => {
    const summary = summarize(series(10, (_, i) => ({ inboundConcealedMs: i * 150 })));
    expect(summary.concealedMsPerSecond).toBe(150);
    expect(summary.quality).toBe("poor");
    expect(summary.issues).toContain("robotic audio (network)");
  });

  it("flags local playout gaps separately from the network", () => {
    const summary = summarize(series(10, (_, i) => ({ playoutUnderruns: i >= 5 ? 1 : 0 })));
    expect(summary.quality).toBe("fair");
    expect(summary.issues).toEqual(["audio gaps (playout)"]);
  });

  it("ignores counter resets after rejoining", () => {
    const samples = [
      { ...base, inboundPacketsLost: 500, inboundPacketsReceived: 9000 },
      { ...base, inboundPacketsLost: 0, inboundPacketsReceived: 50 },
    ];
    expect(summarize(samples).lossPercent).toBe(0);
  });
});
