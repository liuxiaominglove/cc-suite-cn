import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BRIDGE_PATH = resolve(__dirname, "opencode-mcp-bridge.mjs");

export function buildBridgeConfig({ gate = "closed", maxCallbacks = null, callbackLog = null } = {}) {
  const bridge = {
    command: "node",
    args: [BRIDGE_PATH],
  };
  const env = {};
  if (gate === "open") env.OPC_BRIDGE_GATE = "open";
  if (maxCallbacks != null) env.OPC_MAX_CALLBACKS = String(maxCallbacks);
  if (callbackLog) env.OPC_CALLBACK_LOG = callbackLog;
  if (Object.keys(env).length) bridge.env = env;
  return { mcpServers: { bridge } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gate = process.argv.includes("--open") ? "open" : "closed";
  console.log(JSON.stringify(buildBridgeConfig({ gate }), null, 2));
}
