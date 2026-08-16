import { homedir } from "node:os";
import { join, normalize } from "node:path";

function resolveDbPath(path) {
  if (path.startsWith("~")) {
    path = join(homedir(), path.slice(1));
  }
  return normalize(path);
}

function openDb(dbPath) {
  const resolved = resolveDbPath(dbPath);
  return { path: resolved };
}

function main() {
  console.log(openDb("~/data.db").path);
}

main();
