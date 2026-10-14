import { describe, expect, it } from "vitest";

import { releaseNotes } from "./release-notes.mjs";

const changelog = `# Changelog

Intro text.

## [0.3.0] - 2026-11-01

### New
- Text channels.

## [0.2.0] - 2026-10-14

### New
- Push to talk.

## [0.1.0] - 2026-10-13
`;

describe("releaseNotes", () => {
  it("returns only the requested version's section", () => {
    expect(releaseNotes(changelog, "0.3.0")).toBe("### New\n- Text channels.");
    expect(releaseNotes(changelog, "0.2.0")).toBe("### New\n- Push to talk.");
  });

  it("rejects missing or empty sections", () => {
    expect(releaseNotes(changelog, "0.1.0")).toBeNull();
    expect(releaseNotes(changelog, "9.9.9")).toBeNull();
    expect(releaseNotes(changelog, "0.2")).toBeNull();
  });

  it("handles Windows line endings", () => {
    expect(releaseNotes(changelog.replace(/\n/g, "\r\n"), "0.2.0")).toBe("### New\n- Push to talk.");
  });
});
