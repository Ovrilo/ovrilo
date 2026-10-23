import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import { nativeVoice, useVoice, voice } from "../voice/voice";

/** Release builds only: dev builds are not published, so there is nothing to update to. */
const updatesEnabled = nativeVoice && import.meta.env.PROD;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type State =
  | { phase: "idle" }
  | { phase: "available"; update: Update }
  | { phase: "installing"; update: Update; percent: number | null }
  | { phase: "failed"; update: Update; message: string };

/**
 * Offers a signed update from the release feed (tauri.conf.json → plugins.updater). Never restarts
 * on its own: the user starts the install, and during a call must confirm leaving it first.
 * Check or install failures leave the running app untouched.
 */
export function UpdateBanner() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { snapshot } = useVoice();
  const inCall = snapshot.connection !== "disconnected";

  useEffect(() => {
    if (!updatesEnabled) return;
    let cancelled = false;
    const run = () =>
      check()
        .then((update) => {
          if (!cancelled && update) setState((s) => (s.phase === "idle" ? { phase: "available", update } : s));
        })
        // Offline or feed unavailable: try again at the next interval.
        .catch(() => undefined);
    void run();
    const timer = setInterval(run, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.phase === "idle") return null;
  const { update } = state;

  const install = async () => {
    setConfirmLeave(false);
    if (inCall) await voice.leave();
    let total = 0;
    let received = 0;
    setState({ phase: "installing", update, percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          setState({ phase: "installing", update, percent: total > 0 ? Math.round((received / total) * 100) : null });
        }
      });
      await relaunch();
    } catch (error) {
      setState({ phase: "failed", update, message: String(error) });
    }
  };

  return (
    <section className="update-banner" aria-live="polite">
      <Download size={16} aria-hidden="true" />
      <div className="update-text">
        <strong>Ovrilo {update.version} is available</strong>
        {state.phase === "installing" && (
          <span className="muted small">
            {state.percent === null ? "Downloading…" : `Downloading… ${state.percent}%`}
          </span>
        )}
        {state.phase === "failed" && <span className="form-error small">Update failed. Try again later.</span>}
        {confirmLeave && <span className="muted small">This leaves your voice call.</span>}
      </div>
      {state.phase !== "installing" &&
        (inCall && !confirmLeave ? (
          <button className="primary small-button" onClick={() => setConfirmLeave(true)}>
            Update
          </button>
        ) : (
          <button className="primary small-button" onClick={() => void install()}>
            {confirmLeave ? "Leave & update" : "Update now"}
          </button>
        ))}
    </section>
  );
}
