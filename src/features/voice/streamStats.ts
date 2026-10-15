/** What a viewer actually receives from a screen share, for the line under the stream title. */
export interface StreamStats {
  width: number;
  height: number;
  fps: number;
  /** Received bitrate since the previous sample. */
  kbps: number;
  /** For example `H264` or `VP8`. */
  codec: string | null;
  /** Totals, to compute the next bitrate. */
  bytes: number;
  at: number;
}

/**
 * Reads the inbound video entry of a WebRTC stats report (one per receiver). Returns null until
 * frames have been decoded.
 */
export function summarizeInbound(report: Iterable<[string, unknown]>, previous: StreamStats | null, now: number): StreamStats | null {
  const entries = new Map<string, Record<string, unknown>>();
  for (const [id, value] of report) entries.set(id, value as Record<string, unknown>);
  const inbound = [...entries.values()].find((s) => s.type === "inbound-rtp" && s.kind === "video");
  if (!inbound || typeof inbound.frameWidth !== "number") return null;

  const bytes = typeof inbound.bytesReceived === "number" ? inbound.bytesReceived : 0;
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  const codec = typeof inbound.codecId === "string" ? entries.get(inbound.codecId)?.mimeType : undefined;
  return {
    width: inbound.frameWidth,
    height: typeof inbound.frameHeight === "number" ? inbound.frameHeight : 0,
    fps: typeof inbound.framesPerSecond === "number" ? Math.round(inbound.framesPerSecond) : 0,
    kbps: previous && seconds > 0 ? Math.max(0, Math.round(((bytes - previous.bytes) * 8) / seconds / 1000)) : 0,
    codec: typeof codec === "string" ? codec.replace(/^video\//, "").toUpperCase() : null,
    bytes,
    at: now,
  };
}

export function formatStats(stats: StreamStats): string {
  const rate = stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1)} Mbps` : `${stats.kbps} kbps`;
  return [`${stats.width}×${stats.height}`, `${stats.fps} fps`, rate, stats.codec].filter(Boolean).join(" · ");
}
