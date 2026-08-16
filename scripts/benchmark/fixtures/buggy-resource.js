import { openSync } from "node:fs";

function readConfig(path) {
  const fd = openSync(path, "r");
  return { fd };
}

function main() {
  const handle = readConfig("config.json");
  console.log(handle.fd);
}

main();
