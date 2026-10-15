import { AppWindow, Gauge, Monitor, RefreshCw, Type } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog } from "../../components/Dialog";
import { IconButton, Select } from "../../components/ui";
import { type ShareOptimization, type SharePreset, useVoice, voice } from "./voice";

const PRESETS: { value: SharePreset; label: string }[] = [
  { value: "1080p30", label: "1080p, 30 fps (recommended)" },
  { value: "1080p60", label: "1080p, 60 fps (more data and CPU)" },
  { value: "720p30", label: "720p, 30 fps (data saver)" },
];

const OPTIMIZATIONS: { value: ShareOptimization; label: string; hint: string; icon: typeof Type }[] = [
  { value: "detail", label: "Sharp text", hint: "Code, documents, apps. Least data.", icon: Type },
  { value: "motion", label: "Smooth motion", hint: "Games and video. Keeps the frame rate.", icon: Gauge },
];

/** Pick a window or screen to share (ADR-0017). Windows can also share their application's sound. */
export function ScreenSharePicker({ onClose }: { onClose: () => void }) {
  const { screenSources, snapshot } = useVoice();
  const [selected, setSelected] = useState<string | null>(snapshot.screenShare?.sourceId ?? null);
  const [preset, setPreset] = useState<SharePreset>(snapshot.screenShare?.preset ?? "1080p30");
  const [optimization, setOptimization] = useState<ShareOptimization>(snapshot.screenShare?.optimization ?? "detail");
  const [withSound, setWithSound] = useState(true);

  useEffect(() => {
    void voice.listScreenSources();
  }, []);

  const source = screenSources?.find((s) => s.id === selected) ?? null;
  const windows = screenSources?.filter((s) => s.kind === "window") ?? [];
  const screens = screenSources?.filter((s) => s.kind === "screen") ?? [];
  const soundPossible = source?.kind === "window" && source.audioAvailable;

  const start = () => {
    if (!source) return;
    void voice.startScreenShare(source.id, preset, optimization, soundPossible && withSound);
    onClose();
  };

  return (
    <Dialog title="Share your screen" onClose={onClose} wide>
      <div className="share-picker-toolbar">
        <span className="muted small">Pick a window (a game, a browser) or a whole screen.</span>
        <IconButton icon={RefreshCw} label="Refresh list" className="small" onClick={() => void voice.listScreenSources()} />
      </div>
      {screenSources === null ? (
        <p className="muted">Looking for windows…</p>
      ) : (
        <div className="share-sources" role="radiogroup" aria-label="What to share">
          {[...windows, ...screens].map((s) => (
            <label key={s.id} className="share-source">
              <input type="radio" name="source" checked={selected === s.id} onChange={() => setSelected(s.id)} />
              {s.kind === "window" ? <AppWindow size={20} aria-hidden="true" /> : <Monitor size={20} aria-hidden="true" />}
              <span>
                <strong title={s.title}>{s.title}</strong>
                <span>{s.kind === "screen" ? "Entire screen, no sound" : (s.application ?? "Window")}</span>
              </span>
            </label>
          ))}
          {windows.length + screens.length === 0 && <p className="muted">Nothing can be shared right now.</p>}
        </div>
      )}
      <div className="share-options">
        <div className="share-optimization" role="radiogroup" aria-label="Optimize for">
          {OPTIMIZATIONS.map((o) => (
            <label key={o.value} className="share-optimization-option">
              <input
                type="radio"
                name="optimization"
                checked={optimization === o.value}
                onChange={() => setOptimization(o.value)}
              />
              <o.icon size={18} aria-hidden="true" />
              <span>
                <strong>{o.label}</strong>
                <span>{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label>
          Quality
          <Select value={preset} onChange={(e) => setPreset(e.target.value as SharePreset)}>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={soundPossible && withSound}
            disabled={!soundPossible}
            onChange={(e) => setWithSound(e.target.checked)}
          />
          <span>
            Share sound{source?.kind === "window" && source.application ? ` from ${source.application}` : ""}
            <span className="field-hint">
              {source?.kind === "screen"
                ? "Sound can be shared with a window, not a whole screen."
                : "Only this application's sound; your voice chat is never included."}
            </span>
          </span>
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!source} onClick={start}>
          {snapshot.screenShare ? "Switch" : "Go live"}
        </button>
      </div>
    </Dialog>
  );
}
