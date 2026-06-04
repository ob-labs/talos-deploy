import { describe, it, expect, vi } from "vitest";
import EventEmitter from "events";
import { Writable, Readable } from "stream";
import { sshProxyCommand } from "../commands/ssh-proxy.js";
import type { SshProxyDeps } from "../commands/ssh-proxy.js";

function makeWritable() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  return { stream, data: () => Buffer.concat(chunks).toString() };
}

function makeReadable() {
  return new Readable({ read() {} });
}

describe("sshProxyCommand", () => {
  it("writes error to stderr and exits 1 when no auth token is configured", async () => {
    const { stream: stderr, data: stderrData } = makeWritable();
    let exitCode: number | undefined;

    const deps: SshProxyDeps = {
      loadConfig: () => null,
      apiFetch: vi.fn(),
      createWebSocket: vi.fn(),
      stdin: makeReadable(),
      stdout: makeWritable().stream,
      stderr,
      exit: (code) => { exitCode = code; throw new Error(`exit:${code}`); },
    };

    await expect(sshProxyCommand("default", deps)).rejects.toThrow("exit:1");
    expect(exitCode).toBe(1);
    expect(stderrData()).toContain("Not logged in");
  });

  it("writes error and exits 1 when sandbox is not found", async () => {
    const { stream: stderr, data: stderrData } = makeWritable();
    let exitCode: number | undefined;

    const mockResp = { ok: true, json: async () => ({ sandboxes: [] }) };

    const deps: SshProxyDeps = {
      loadConfig: () => ({ version: 2, token: "mytoken", email: "", userId: 1, serverUrl: "http://localhost:3080" }),
      apiFetch: vi.fn().mockResolvedValue(mockResp),
      createWebSocket: vi.fn(),
      stdin: makeReadable(),
      stdout: makeWritable().stream,
      stderr,
      exit: (code) => { exitCode = code; throw new Error(`exit:${code}`); },
    };

    await expect(sshProxyCommand("myproject", deps)).rejects.toThrow("exit:1");
    expect(exitCode).toBe(1);
    expect(stderrData()).toContain("No sandbox found");
  });

  it("pipes stdin to WebSocket and WebSocket messages to stdout", async () => {
    const stdinStream = makeReadable();
    const { stream: stdout, data: stdoutData } = makeWritable();

    const ws = new EventEmitter() as any;
    ws.readyState = 1; // OPEN
    ws.send = vi.fn();
    ws.close = vi.fn();
    const OPEN = 1;

    const mockSandbox = { id: 42, status: "active" };
    const mockResp = { ok: true, json: async () => ({ sandboxes: [mockSandbox] }) };

    const deps: SshProxyDeps = {
      loadConfig: () => ({ version: 2, token: "mytoken", email: "", userId: 1, serverUrl: "http://localhost:3080" }),
      apiFetch: vi.fn().mockResolvedValue(mockResp),
      createWebSocket: vi.fn().mockReturnValue(ws),
      stdin: stdinStream,
      stdout,
      stderr: makeWritable().stream,
      exit: (code) => { throw new Error(`exit:${code}`); },
    };

    const proxyPromise = sshProxyCommand("default", deps);

    // Yield microtask queue so apiFetch + json() resolve and WS listeners attach
    await new Promise((r) => setImmediate(r));

    // Simulate WS open
    ws.emit("open");

    // Send stdin data — should be forwarded to WS
    stdinStream.push(Buffer.from("hello from ssh client"));

    // Simulate data arriving from WS — should go to stdout
    ws.emit("message", Buffer.from("hello from pod"));

    // Let the data handler flush
    await new Promise((r) => setImmediate(r));

    stdinStream.push(null); // end stdin
    ws.emit("close", 1000, Buffer.from("normal"));

    await proxyPromise;

    expect(ws.send).toHaveBeenCalledWith(Buffer.from("hello from ssh client"));
    expect(stdoutData()).toContain("hello from pod");
  });
});
