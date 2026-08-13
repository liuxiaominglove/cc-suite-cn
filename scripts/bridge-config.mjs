import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BRIDGE_PATH = resolve(__dirname, "opencode-mcp-bridge.mjs");

export function buildBridgeConfig({ gate = "closed" } = {}) {
  const bridge = {
    command: "node",
    args: [BRIDGE_PATH],
  };
  if (gate === "open") {
    bridge.env = { OPC_BRIDGE_GATE: "open" };
  }
  return { mcpServers: { bridge } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gate = process.argv.includes("--open") ? "open" : "closed";
  console.log(JSON.stringify(buildBridgeConfig({ gate }), null, 2));
}
