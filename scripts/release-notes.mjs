// Prints the CHANGELOG.md section for one version (used as GitHub release notes and in latest.json).
// Usage: node scripts/release-notes.mjs 0.2.0
// Fails when the section is missing or empty, so every release ships curated notes.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## ["));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return notes || null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  const notes = version ? releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version) : null;
  if (!notes) {
    console.error(`CHANGELOG.md has no notes for ${version ?? "(no version given)"}`);
    process.exit(1);
  }
  process.stdout.write(notes + "\n");
}
