import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn, spawnSync } from "child_process";
import { getSshKeyPath } from "../config/index.js";
import { api } from "../api/client.js";

// ── SSH key management ─────────────────────────────────

export function ensureSshKey() {
  const keyPath = getSshKeyPath();
  if (!fs.existsSync(keyPath)) {
    console.log("No SSH key found, generating one...");
    execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N ""`, { stdio: "pipe" });
    console.log("SSH key generated.");
  }
}

export async function uploadSshKey() {
  const pubKeyPath = getSshKeyPath() + ".pub";
  const pubKey = fs.readFileSync(pubKeyPath, "utf-8").trim();
  const resp = await api("/api/ssh-keys", {
    method: "POST",
    body: JSON.stringify({ public_key: pubKey, name: "default" }),
  });
  return resp.ok;
}

// ── Port-forward ───────────────────────────────────────

export function establishPortForward(
  podName: string,
  namespace: string
): Promise<{ port: number; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const pf = spawn("kubectl", ["port-forward", podName, "0:22", "-n", namespace], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      pf.kill();
      reject(new Error("port-forward timeout (15s)"));
    }, 15_000);

    const onPort = (data: Buffer) => {
      const match = data.toString().match(/Forwarding from\s+\d+\.\d+\.\d+\.\d+:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        resolve({
          port,
          cleanup: () => {
            pf.kill();
          },
        });
      }
    };

    pf.stdout!.on("data", onPort);
    pf.stderr!.on("data", onPort);
  });
}

// ── SSH config update ──────────────────────────────────

export function updateSshConfig(project: string, port: number) {
  const sshConfigPath = path.join(os.homedir(), ".ssh/config");
  let content = "";
  if (fs.existsSync(sshConfigPath)) {
    content = fs.readFileSync(sshConfigPath, "utf-8");
  }

  const hostAlias = `tt-${project}`;
  const block = `\nHost ${hostAlias}\n  HostName localhost\n  Port ${port}\n  User coder\n  StrictHostKeyChecking no\n  IdentityFile ~/.ssh/id_ed25519\n`;

  const regex = new RegExp(`\n?Host ${hostAlias}\n(?:  .*\n)*`);
  if (regex.test(content)) {
    content = content.replace(regex, block);
  } else {
    content += block;
  }

  fs.writeFileSync(sshConfigPath, content);
}

// ── SSH session ────────────────────────────────────────

export function sshIntoSandbox(port: number) {
  const sshKeyPath = getSshKeyPath();
  const ssh = spawnSync(
    "ssh",
    [
      "-p", String(port),
      "-i", sshKeyPath,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "coder@localhost",
    ],
    { stdio: "inherit" }
  );

  if (ssh.error) {
    console.error("SSH failed:", ssh.error.message);
  }
}
