import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("app_version")
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="app-shell">
      <nav className="space-rail" aria-label="Spaces" />
      <aside className="channel-sidebar" aria-label="Channels">
        <span className="muted">No space selected</span>
      </aside>
      <main className="main-pane">
        <h1>Ovrilo</h1>
        <span className="muted">
          Development build{version ? ` · v${version}` : ""}
        </span>
      </main>
    </div>
  );
}

export default App;
