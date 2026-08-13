import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runOpencode, setSpawn, checkGate, createServer, checkCallbackLimit, appendCallback, readCallbacks } from "./opencode-mcp-bridge.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function createMockProc({ stdout = "", stderr = "", exitCode = 0, delayMs = 0 } = {}) {
  const stdoutStream = new EventEmitter();
  const stderrStream = new EventEmitter();
  const events = new EventEmitter();
  let killed = false;

  const close = (code) => {
    if (stdout) stdoutStream.emit("data", Buffer.from(stdout));
    stdoutStream.emit("end");
    if (stderr) stderrStream.emit("data", Buffer.from(stderr));
    stderrStream.emit("end");
    events.emit("close", code);
  };

  const proc = {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: (e, cb) => {
      events.on(e, cb);
      return proc;
    },
    kill: () => {
      killed = true;
    },
  };

  if (delayMs > 0) {
    setTimeout(() => {
      if (!killed) close(exitCode);
    }, delayMs);
  } else {
    setImmediate(() => {
      if (!killed) close(exitCode);
    });
  }

  return proc;
}

describe("runOpencode", () => {
  afterEach(() => setSpawn(null));

  it("returns output on success", async () => {
    setSpawn(() => createMockProc({ stdout: "ok" }));
    const r = await runOpencode("some task");
    assert.equal(r.ok, true);
    assert.equal(r.output, "ok");
  });

  it("returns timeout when process never closes", async () => {
    setSpawn(() => createMockProc({ delayMs: 5000 }));
    const r = await runOpencode("task", { timeoutMs: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeout");
  });

  it("returns exit failure with stderr", async () => {
    setSpawn(() => createMockProc({ exitCode: 1, stderr: "boom" }));
    const r = await runOpencode("task");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "exit_1");
    assert.equal(r.stderr, "boom");
  });

  it("returns opencode_not_found when spawn throws ENOENT", async () => {
    setSpawn(() => {
      const e = new Error("spawn opencode ENOENT");
      e.code = "ENOENT";
      throw e;
    });
    const r = await runOpencode("task");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "opencode_not_found");
  });
});

describe("checkGate", () => {
  it("returns true when gate is open", () => {
    assert.equal(checkGate({ OPC_BRIDGE_GATE: "open" }), true);
  });

  it("returns false when gate is unset", () => {
    assert.equal(checkGate({}), false);
  });

  it("returns false when gate is closed", () => {
    assert.equal(checkGate({ OPC_BRIDGE_GATE: "closed" }), false);
  });
});

async function makeClient(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe("createServer (delegate_to_opencode)", () => {
  it("lists the delegate_to_opencode tool", async () => {
    const client = await makeClient(createServer({ env: { OPC_BRIDGE_GATE: "open" } }));
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("delegate_to_opencode"));
    await client.close();
  });

  it("refuses to delegate when gate is closed, without running opencode", async () => {
    let called = false;
    const run = async () => {
      called = true;
      return { ok: true, output: "x" };
    };
    const client = await makeClient(createServer({ runOpencodeFn: run, env: {} }));
    const result = await client.callTool({ name: "delegate_to_opencode", arguments: { task: "x" } });
    const text = result.content.map((c) => c.text).join("");
    assert.ok(text.includes("禁止回派"));
    assert.equal(called, false);
    await client.close();
  });

  it("delegates when gate is open", async () => {
    const run = async (task) => ({ ok: true, output: `opencode replied: ${task}` });
    const client = await makeClient(createServer({ runOpencodeFn: run, env: { OPC_BRIDGE_GATE: "open" } }));
    const result = await client.callTool({ name: "delegate_to_opencode", arguments: { task: "hello" } });
    const text = result.content.map((c) => c.text).join("");
    assert.ok(text.includes("opencode replied: hello"));
    await client.close();
  });

  it("marks a validation error when task is missing", async () => {
    const client = await makeClient(createServer({ env: { OPC_BRIDGE_GATE: "open" } }));
    const result = await client.callTool({ name: "delegate_to_opencode", arguments: {} });
    assert.equal(result.isError, true);
    await client.close();
  });
});

import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("checkCallbackLimit", () => {
  it("allows when count is below max", () => {
    assert.equal(checkCallbackLimit(0, 5), true);
    assert.equal(checkCallbackLimit(4, 5), true);
  });

  it("refuses when count reaches max", () => {
    assert.equal(checkCallbackLimit(5, 5), false);
    assert.equal(checkCallbackLimit(6, 5), false);
  });
});

describe("appendCallback / readCallbacks", () => {
  it("appends and reads callback entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-test-"));
    const log = join(dir, "cb.jsonl");
    await appendCallback(log, { timestamp: "t1", task: "a" });
    await appendCallback(log, { timestamp: "t2", task: "b" });
    const entries = await readCallbacks(log);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].task, "a");
    assert.equal(entries[1].task, "b");
    await rm(dir, { recursive: true, force: true });
  });

  it("returns [] when log missing", async () => {
    const entries = await readCallbacks("/nonexistent/cb.jsonl");
    assert.deepEqual(entries, []);
  });
});

describe("createServer callback limit", () => {
  it("allows up to max callbacks then refuses", async () => {
    let calls = 0;
    const run = async () => { calls += 1; return { ok: true, output: "ok" }; };
    const client = await makeClient(createServer({ runOpencodeFn: run, env: { OPC_BRIDGE_GATE: "open", OPC_MAX_CALLBACKS: "5" } }));
    for (let i = 0; i < 5; i++) {
      const r = await client.callTool({ name: "delegate_to_opencode", arguments: { task: `t${i}` } });
      const text = r.content.map((c) => c.text).join("");
      assert.ok(!text.includes("上限"), `第 ${i + 1} 次应被允许`);
    }
    const r6 = await client.callTool({ name: "delegate_to_opencode", arguments: { task: "t5" } });
    const text6 = r6.content.map((c) => c.text).join("");
    assert.ok(text6.includes("上限"), "第 6 次应被拒");
    assert.equal(calls, 5);
    await client.close();
  });
});
