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

describe("buildBridgeConfig (callback controls)", () => {
  it("sets OPC_MAX_CALLBACKS when maxCallbacks provided", () => {
    const cfg = buildBridgeConfig({ gate: "open", maxCallbacks: 5 });
    assert.equal(cfg.mcpServers.bridge.env.OPC_MAX_CALLBACKS, "5");
  });

  it("sets OPC_CALLBACK_LOG when callbackLog provided", () => {
    const cfg = buildBridgeConfig({ gate: "open", callbackLog: "/tmp/cb.jsonl" });
    assert.equal(cfg.mcpServers.bridge.env.OPC_CALLBACK_LOG, "/tmp/cb.jsonl");
  });

  it("has no env when gate closed and no extras", () => {
    const cfg = buildBridgeConfig({ gate: "closed" });
    assert.equal(cfg.mcpServers.bridge.env, undefined);
  });
});
