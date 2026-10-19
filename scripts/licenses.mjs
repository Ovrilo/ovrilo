// Collects the licenses of everything the installer ships: the Rust crates of the native host
// (Windows build, without dev-dependencies) and the npm packages of the frontend (production
// only). Writes src/assets/third-party-licenses.json, which Settings → About shows.
//
//   node scripts/licenses.mjs           regenerate the file
//   node scripts/licenses.mjs --check   fail when it is stale or a dependency has no license
//
// Rust license files are read from the crates' sources, so run it after a cargo build/fetch.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "src", "assets", "third-party-licenses.json");
const standardTexts = join(root, "scripts", "license-texts");
const check = process.argv.includes("--check");

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-_.][\w.-]*)?$/i;

/** License, notice and copying files at the top of a package directory. */
function licenseTexts(directory) {
  if (!directory || !existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => LICENSE_FILE.test(name) && statSync(join(directory, name)).isFile())
    .sort()
    .map((name) => readFileSync(join(directory, name), "utf8").replace(/\r\n/g, "\n").trim())
    .filter(Boolean);
}

function rustPackages() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--locked", "--filter-platform", "x86_64-pc-windows-msvc"],
      { cwd: join(root, "src-tauri"), maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
    ),
  );
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  // What the app links: everything reachable from the app crate except dev-dependencies.
  const seen = new Set();
  const queue = [metadata.resolve.root];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind !== "dev")) queue.push(dep.pkg);
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    .filter((p) => p.source && !p.source.includes("github.com/Ovrilo/"))
    .map((p) => {
      const dir = dirname(p.manifest_path);
      const texts = licenseTexts(dir);
      if (texts.length === 0 && p.license_file) {
        const file = join(dir, p.license_file);
        if (existsSync(file)) texts.push(readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim());
      }
      return {
        name: p.name,
        version: p.version,
        kind: "rust",
        license: p.license ?? (p.license_file ? "See license text" : null),
        repository: p.repository ?? null,
        texts,
      };
    });
}

function npmPackages() {
  const listed = JSON.parse(
    execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], { cwd: root, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 }),
  );
  return Object.values(listed)
    .flat()
    .flatMap((p) =>
      p.versions.map((version, i) => ({
        name: p.name,
        version,
        kind: "npm",
        license: p.license && p.license !== "Unknown" ? p.license : null,
        repository: p.homepage ?? null,
        texts: licenseTexts(p.paths?.[i] ?? p.paths?.[0]),
      })),
    );
}

/**
 * LiveKit links a prebuilt libwebrtc (with Opus, BoringSSL, libvpx and more); its combined notices
 * come with the download in the build directory.
 */
function webrtcPackage() {
  for (const profile of ["release", "debug"]) {
    const build = join(root, "src-tauri", "target", profile, "build");
    if (!existsSync(build)) continue;
    for (const scratch of readdirSync(build).filter((d) => d.startsWith("scratch-"))) {
      const livekit = join(build, scratch, "out", "livekit_webrtc", "livekit");
      if (!existsSync(livekit)) continue;
      for (const release of readdirSync(livekit)) {
        for (const platform of readdirSync(join(livekit, release))) {
          const file = join(livekit, release, platform, "LICENSE.md");
          if (existsSync(file)) {
            return {
              name: "libwebrtc (LiveKit build)",
              version: release.replace(/^.*webrtc-/, ""),
              kind: "bundled",
              license: "BSD-3-Clause and others (see text)",
              repository: "https://github.com/livekit/rust-sdks",
              texts: [readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim()],
            };
          }
        }
      }
    }
  }
  console.error("The prebuilt libwebrtc and its LICENSE.md were not found. Build src-tauri first (cargo build).");
  process.exit(1);
}

/** The standard text of each license in an SPDX expression, for packages that ship none. */
function standardLicenseTexts(pkg) {
  const ids = new Set((pkg.license ?? "").split(/[\s()/,]+/).filter((id) => id && id !== "OR" && id !== "AND"));
  return [...ids]
    .filter((id) => existsSync(join(standardTexts, `${id}.txt`)))
    .map((id) =>
      readFileSync(join(standardTexts, `${id}.txt`), "utf8")
        .replace(/\r\n/g, "\n")
        .replaceAll("{holders}", `the ${pkg.name} authors`)
        .trim(),
    );
}

const all = [...rustPackages(), ...npmPackages(), webrtcPackage()].map((p) =>
  p.texts.length ? p : { ...p, texts: standardLicenseTexts(p) },
);
const texts = {};
const packages = all
  .map(({ texts: own, ...rest }) => {
    const ids = own.map((text) => {
      const id = createHash("sha256").update(text).digest("hex").slice(0, 16);
      texts[id] = text;
      return id;
    });
    return { ...rest, texts: ids };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.kind.localeCompare(b.kind));

const missing = packages.filter((p) => !p.license);
const sortedTexts = Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)));
const json = `${JSON.stringify({ packages, texts: sortedTexts }, null, 1)}\n`;

if (missing.length) {
  console.error(`No license information for: ${missing.map((p) => `${p.name}@${p.version}`).join(", ")}`);
  process.exit(1);
}
const withoutText = packages.filter((p) => p.texts.length === 0);
if (withoutText.length) {
  console.error(`No license text for: ${withoutText.map((p) => `${p.name}@${p.version} (${p.license})`).join(", ")}`);
  process.exit(1);
}

if (check) {
  const current = existsSync(output) ? readFileSync(output, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== json) {
    console.error("src/assets/third-party-licenses.json is out of date. Run: node scripts/licenses.mjs");
    process.exit(1);
  }
  console.log(`Licenses up to date: ${packages.length} packages.`);
} else {
  writeFileSync(output, json);
  console.log(`Wrote ${packages.length} packages, ${Object.keys(sortedTexts).length} distinct license texts.`);
}
