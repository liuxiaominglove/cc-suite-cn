import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBridgeConfig } from "./bridge-config.mjs";

describe("buildBridgeConfig", () => {
  it("generates a codebuddy mcpServers entry pointing at the bridge", () => {
    const cfg = buildBridgeConfig({ gate: "closed" });
    const bridge = cfg.mcpServers.bridge;
    assert.equal(bridge.command, "node");
    assert.ok(bridge.args[0].endsWith("opencode-mcp-bridge.mjs"));
  });

  it("does not open the gate by default", () => {
    const cfg = buildBridgeConfig({ gate: "closed" });
    const bridge = cfg.mcpServers.bridge;
    assert.ok(!bridge.env || bridge.env.OPC_BRIDGE_GATE !== "open");
  });

  it("sets OPC_BRIDGE_GATE=open when gate is open", () => {
    const cfg = buildBridgeConfig({ gate: "open" });
    const bridge = cfg.mcpServers.bridge;
    assert.equal(bridge.env.OPC_BRIDGE_GATE, "open");
  });
});
