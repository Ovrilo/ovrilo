import { Gamepad2, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Select } from "../../components/ui";
import {
  activityAvailable,
  listRunningPrograms,
  type RunningProgram,
  setActivitySettings,
  useActivitySettings,
  useDetectedGame,
} from "../activity/activity";

/** Sharing the game you play, and programs you mark as games yourself. */
export function ActivitySettingsPage() {
  const settings = useActivitySettings();
  const playing = useDetectedGame();
  const [programs, setPrograms] = useState<RunningProgram[] | null>(null);
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");

  if (!activityAvailable) {
    return <p className="muted">Game activity is available in the desktop app.</p>;
  }

  const addable = (programs ?? []).filter((p) => !settings.games.some((g) => g.exe.toLowerCase() === p.exe.toLowerCase()));
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = name.trim();
    if (!picked || !label) return;
    setActivitySettings({ ...settings, games: [...settings.games, { exe: picked, name: label.slice(0, 128) }] });
    setPicked("");
    setName("");
    setPrograms(null);
  };

  return (
    <div className="settings-page">
      <section className="settings-group" aria-labelledby="activity-share">
        <h3 id="activity-share">Game activity</h3>
        <label className="sound-toggle">
          <input
            type="checkbox"
            checked={settings.share}
            onChange={(e) => setActivitySettings({ ...settings, share: e.target.checked })}
          />
          <span>Show friends and community members which game you are playing</span>
        </label>
        <p className="activity-now">
          <Gamepad2 size={16} aria-hidden="true" />
          {playing ? (
            <span>
              Playing <strong>{playing}</strong>
              {!settings.share && <span className="muted"> (not shared)</span>}
            </span>
          ) : (
            <span className="muted">No game detected right now.</span>
          )}
        </p>
        <p className="muted small">
          Ovrilo recognises games from your Steam, Epic Games and Xbox libraries and some popular games. Only the game's
          name is shared, never other programs. Nothing is shared while you are invisible.
        </p>
      </section>

      <section className="settings-group" aria-labelledby="activity-games">
        <h3 id="activity-games">Your games</h3>
        {settings.games.length > 0 ? (
          <ul className="sound-list">
            {settings.games.map((game) => (
              <li key={game.exe} className="sound-row">
                <span>
                  {game.name} <span className="muted small">{game.exe}</span>
                </span>
                <button
                  className="icon-button small tone-danger"
                  aria-label={`Remove ${game.name}`}
                  title="Remove"
                  onClick={() =>
                    setActivitySettings({ ...settings, games: settings.games.filter((g) => g.exe !== game.exe) })
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Not recognised? Start the game, then add it here.</p>
        )}
        {programs === null ? (
          <button className="with-icon" onClick={() => void listRunningPrograms(settings.games).then(setPrograms)}>
            <Gamepad2 size={14} aria-hidden="true" /> Add a game
          </button>
        ) : (
          <form className="add-game" onSubmit={add}>
            <label>
              Running program
              <Select
                value={picked}
                onChange={(e) => {
                  setPicked(e.target.value);
                  const program = addable.find((p) => p.exe === e.target.value);
                  setName(program?.detected ?? e.target.value.replace(/\.exe$/i, ""));
                }}
                required
              >
                <option value="">Choose a program</option>
                {addable.map((p) => (
                  <option key={p.exe} value={p.exe}>
                    {p.exe}
                    {p.detected ? ` (${p.detected})` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Name to show
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} required autoComplete="off" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setPrograms(null)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!picked || !name.trim()}>
                Add game
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
