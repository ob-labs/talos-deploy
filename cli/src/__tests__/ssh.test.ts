import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import EventEmitter from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { updateSshConfig, resolveTalosBinaryPath, sshIntoSandbox } from "../lib/ssh.js";

describe("resolveTalosBinaryPath", () => {
  it("returns the path from 'which talosd' when available", () => {
    const fakeExec = (_cmd: string) => Buffer.from("/usr/local/bin/talosd\n");
    const result = resolveTalosBinaryPath(fakeExec, ["/usr/bin/node", "/some/script.js"]);
    expect(result).toBe("/usr/local/bin/talosd");
  });

  it("falls back to process.argv[1] as absolute path when which fails", () => {
    const fakeExec = (_cmd: string) => { throw new Error("not found"); };
    const result = resolveTalosBinaryPath(fakeExec, ["/usr/bin/node", "/usr/local/bin/talosd"]);
    expect(result).toBe("/usr/local/bin/talosd");
  });

  it("resolves relative argv[1] to absolute path", () => {
    const fakeExec = (_cmd: string) => { throw new Error("not found"); };
    const result = resolveTalosBinaryPath(fakeExec, ["/usr/bin/node", "dist/index.js"]);
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toContain("dist/index.js");
  });
});

describe("updateSshConfig", () => {
  let tmpDir: string;
  let sshConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "talos-test-"));
    sshConfigPath = path.join(tmpDir, "config");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("creates SSH config with ProxyCommand block when file does not exist", () => {
    updateSshConfig("default", "/usr/local/bin/talosd", sshConfigPath);

    const content = fs.readFileSync(sshConfigPath, "utf-8");
    expect(content).toContain("Host tt-default");
    expect(content).toContain("ProxyCommand /usr/local/bin/talosd ssh-proxy --project default");
    expect(content).toContain("User coder");
    expect(content).toContain("StrictHostKeyChecking no");
    expect(content).toContain("UserKnownHostsFile /dev/null");
    expect(content).toContain("IdentityFile ~/.ssh/id_ed25519");
  });

  it("appends ProxyCommand block to existing SSH config that lacks the host", () => {
    fs.writeFileSync(sshConfigPath, "Host someother\n  HostName example.com\n");

    updateSshConfig("myproject", "/usr/local/bin/talosd", sshConfigPath);

    const content = fs.readFileSync(sshConfigPath, "utf-8");
    expect(content).toContain("Host someother");
    expect(content).toContain("Host tt-myproject");
    expect(content).toContain("ProxyCommand /usr/local/bin/talosd ssh-proxy --project myproject");
  });

  it("replaces existing tt-{project} block with new ProxyCommand block", () => {
    const existing =
      "Host other\n  HostName example.com\n\n" +
      "Host tt-default\n  HostName localhost\n  Port 12345\n  User coder\n  StrictHostKeyChecking no\n  IdentityFile ~/.ssh/id_ed25519\n";
    fs.writeFileSync(sshConfigPath, existing);

    updateSshConfig("default", "/usr/local/bin/talosd", sshConfigPath);

    const content = fs.readFileSync(sshConfigPath, "utf-8");
    expect(content).not.toContain("Port 12345");
    expect(content).not.toContain("HostName localhost");
    expect(content).toContain("ProxyCommand /usr/local/bin/talosd ssh-proxy --project default");
    expect(content).toContain("Host other");
  });

  it("uses the provided binary path in ProxyCommand", () => {
    updateSshConfig("dev", "/home/user/.local/bin/talosd", sshConfigPath);

    const content = fs.readFileSync(sshConfigPath, "utf-8");
    expect(content).toContain("ProxyCommand /home/user/.local/bin/talosd ssh-proxy --project dev");
  });
});

describe("sshIntoSandbox", () => {
  it("spawns ssh with the host alias tt-{project}", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];

    const fakeSpawn = (cmd: string, args: string[], _opts: object) => {
      capturedCmd = cmd;
      capturedArgs = args;
      const proc = new EventEmitter() as any;
      proc.stdin = null;
      proc.stdout = null;
      proc.stderr = null;
      setImmediate(() => proc.emit("close", 0));
      return proc;
    };

    await sshIntoSandbox("default", fakeSpawn as any);

    expect(capturedCmd).toBe("ssh");
    expect(capturedArgs).toContain("tt-default");
    expect(capturedArgs).not.toContain("-p");
  });

  it("rejects when ssh exits with non-zero code", async () => {
    const fakeSpawn = (_cmd: string, _args: string[], _opts: object) => {
      const proc = new EventEmitter() as any;
      setImmediate(() => proc.emit("close", 255));
      return proc;
    };

    await expect(sshIntoSandbox("default", fakeSpawn as any)).rejects.toThrow();
  });
});
