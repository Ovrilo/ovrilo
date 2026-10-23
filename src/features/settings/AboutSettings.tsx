import { useEffect, useMemo, useState } from "react";

import { version } from "../../../package.json";

interface Notices {
  packages: { name: string; version: string; kind: "rust" | "npm" | "bundled"; license: string; repository: string | null; texts: string[] }[];
  texts: Record<string, string>;
}

const KIND_LABEL = { rust: "Rust crate", npm: "npm package", bundled: "Bundled library" } as const;

/** App version and the licenses of the third-party software it ships (scripts/licenses.mjs). */
export function AboutSettings() {
  const [notices, setNotices] = useState<Notices | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    // About 1 MB: loaded only when this page opens.
    import("../../assets/third-party-licenses.json")
      .then((m) => setNotices(m.default as Notices))
      .catch(() => setFailed(true));
  }, []);

  const query = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (notices?.packages ?? []).filter(
        (p) => !query || p.name.toLowerCase().includes(query) || p.license.toLowerCase().includes(query),
      ),
    [notices, query],
  );

  return (
    <div className="settings-page">
      <section className="settings-group" aria-labelledby="about-app">
        <h3 id="about-app">Ovrilo {version}</h3>
        <p className="muted small">
          Voice and text chat for the people you play with. Downloads and release notes:{" "}
          <span className="selectable">ovrilo.github.io/ovrilo-releases</span>
        </p>
        <p className="muted small">
          Ovrilo is free software under the GNU Affero General Public License, version 3. Its source code is at{" "}
          <span className="selectable">github.com/Ovrilo/ovrilo</span>.
        </p>
      </section>
      <section className="settings-group" aria-labelledby="about-licenses">
        <h3 id="about-licenses">Third-party software</h3>
        <p className="muted small">
          Ovrilo is built with open-source software. Each entry below lists its license; open it for the full text.
        </p>
        {failed ? (
          <p className="form-error small">The license list could not be loaded.</p>
        ) : !notices ? (
          <p className="muted small">Loading…</p>
        ) : (
          <>
            <input
              type="search"
              placeholder={`Search ${notices.packages.length} libraries`}
              aria-label="Search libraries"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <ul className="license-list">
              {shown.map((p) => (
                <li key={`${p.kind}:${p.name}@${p.version}`}>
                  <details>
                    <summary>
                      <span className="license-name">
                        {p.name} <span className="muted">{p.version}</span>
                      </span>
                      <span className="muted small">
                        {p.license} · {KIND_LABEL[p.kind]}
                      </span>
                    </summary>
                    {p.repository && <p className="muted small selectable">{p.repository}</p>}
                    {p.texts.map((id) => (
                      <pre key={id} className="license-text">
                        {notices.texts[id]}
                      </pre>
                    ))}
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
