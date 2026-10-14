import { Signal, SignalLow, SignalMedium } from "lucide-react";

import type { QualitySummary } from "./quality";

const LABEL = { good: "Good connection", fair: "Unstable connection", poor: "Poor connection", unknown: "Measuring…" };

/** Connection health with text and shape, never color alone (DESIGN.md §4, §8). */
export function QualityBadge({ summary, compact = false }: { summary: QualitySummary; compact?: boolean }) {
  const Icon = summary.quality === "poor" ? SignalLow : summary.quality === "fair" ? SignalMedium : Signal;
  const detail = summary.issues.length > 0 ? summary.issues.join(", ") : undefined;
  return (
    <span className={`quality quality-${summary.quality}`} title={detail ?? LABEL[summary.quality]}>
      <Icon size={14} aria-hidden="true" />
      {compact ? (
        <span className="visually-hidden">{LABEL[summary.quality]}</span>
      ) : (
        <span>{LABEL[summary.quality]}</span>
      )}
      {!compact && summary.roundTripMs !== null && <span className="quality-ms">{summary.roundTripMs} ms</span>}
    </span>
  );
}
