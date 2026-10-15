/** Voice diagnostics as emitted by the host (`voice://stats`, src-tauri/src/voice.rs). Counters are cumulative. */
export interface VoiceStats {
  roundTripMs: number | null;
  inboundPacketsReceived: number;
  inboundPacketsLost: number;
  inboundJitterMs: number | null;
  /** Remote audio synthesized to hide loss: heard as robotic voice. */
  inboundConcealedMs: number;
  outboundPacketsLost: number;
  playoutBufferedMs: number;
  playoutUnderruns: number;
  playoutSkippedMs: number;
  captureOverflowMs: number;
  remoteFramesDropped: number;
  microphoneFramesDropped: number;
}

export type Quality = "good" | "fair" | "poor" | "unknown";

/** Round-trip time from which the connection counts as unstable, and as poor. */
export const LATENCY_UNSTABLE_MS = 50;
export const LATENCY_POOR_MS = 100;

/** Recent connection health computed over a window of stats samples (oldest first, ~1 per second). */
export interface QualitySummary {
  quality: Quality;
  roundTripMs: number | null;
  jitterMs: number | null;
  /** Inbound packet loss in the window, percent. */
  lossPercent: number;
  /** Robotic (concealed) audio per second of listening in the window. */
  concealedMsPerSecond: number;
  /** Gaps and jumps in our own playout in the window. */
  underruns: number;
  skippedMs: number;
  /** Frames dropped locally in the window (remote queue + microphone). */
  droppedFrames: number;
  /** Human-readable problems seen in the window, including isolated ones that did not lower the rating. */
  issues: string[];
}

const EMPTY: QualitySummary = {
  quality: "unknown",
  roundTripMs: null,
  jitterMs: null,
  lossPercent: 0,
  concealedMsPerSecond: 0,
  underruns: 0,
  skippedMs: 0,
  droppedFrames: 0,
  issues: [],
};

export function summarize(samples: readonly VoiceStats[]): QualitySummary {
  const last = samples[samples.length - 1];
  if (!last) return EMPTY;
  const first = samples.length > 1 ? samples[0]! : last;
  // Counters restart when rejoining; never report negative deltas.
  const delta = (pick: (s: VoiceStats) => number) => Math.max(0, pick(last) - pick(first));
  const seconds = Math.max(1, samples.length - 1);

  const received = delta((s) => s.inboundPacketsReceived);
  const lost = delta((s) => s.inboundPacketsLost);
  const lossPercent = received + lost > 0 ? (lost / (received + lost)) * 100 : 0;
  const concealedMsPerSecond = delta((s) => s.inboundConcealedMs) / seconds;
  const underruns = delta((s) => s.playoutUnderruns);
  const skippedMs = delta((s) => s.playoutSkippedMs);
  const droppedFrames = delta((s) => s.remoteFramesDropped) + delta((s) => s.microphoneFramesDropped);

  // The badge rates the internet connection. Local audio hiccups (a CPU spike delaying playout)
  // are listed too, but only change the rating when they keep happening.
  const issues: string[] = [];
  let level: 0 | 1 | 2 = 0;
  const flag = (condition: boolean, issue: string, severity: 0 | 1 | 2) => {
    if (!condition) return;
    issues.push(issue);
    level = Math.max(level, severity) as 0 | 1 | 2;
  };
  const rtt = last.roundTripMs ?? 0;
  flag(lossPercent >= 1, `${lossPercent.toFixed(1)}% packet loss`, lossPercent >= 5 ? 2 : 1);
  flag(concealedMsPerSecond >= 20, "robotic audio (network)", concealedMsPerSecond >= 100 ? 2 : 1);
  flag(rtt >= LATENCY_UNSTABLE_MS, `high latency (${rtt} ms)`, rtt >= LATENCY_POOR_MS ? 2 : 1);
  flag((last.inboundJitterMs ?? 0) >= 30, `unstable network (${last.inboundJitterMs} ms jitter)`, 1);
  flag(underruns > 0, "audio gaps (playout)", underruns >= 10 ? 2 : underruns >= 3 ? 1 : 0);
  flag(skippedMs > 0, "audio skips (playout)", skippedMs >= 200 ? 1 : 0);
  flag(droppedFrames > 0, "dropped audio frames", droppedFrames >= 10 ? 1 : 0);

  return {
    quality: samples.length < 2 ? "unknown" : (["good", "fair", "poor"] as const)[level],
    roundTripMs: last.roundTripMs,
    jitterMs: last.inboundJitterMs,
    lossPercent,
    concealedMsPerSecond,
    underruns,
    skippedMs,
    droppedFrames,
    issues,
  };
}
