// Copies the committed OpenAPI contract from a local ovrilo-api checkout into api/.
// Usage: pnpm api:sync [path-to-ovrilo-api]   (default: ../ovrilo-api)
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRepo = resolve(process.argv[2] ?? "../ovrilo-api");
const source = resolve(apiRepo, "openapi/ovrilo-api.json");
const target = resolve("api/ovrilo-api.json");

copyFileSync(source, target);
const { info } = JSON.parse(readFileSync(target, "utf8"));
console.log(`Synced ${info.title} contract ${info.version} from ${source}`);
