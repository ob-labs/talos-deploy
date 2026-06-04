#!/usr/bin/env node
import { Command } from "commander";
import { authLoginCommand, authStatusCommand, authLogoutCommand } from "./commands/auth.js";
import { upCommand } from "./commands/up.js";
import { sshProxyCommand } from "./commands/ssh-proxy.js";

const program = new Command();
program
  .name("talosd")
  .description("Talos Deploy CLI — sandbox environments for Claude Code")
  .version("0.1.0");

// ── auth ──────────────────────────────────────────────────

const authCmd = program
  .command("auth")
  .description("Manage authentication")
  .action(async () => {
    // Default: show status (like `gh auth`)
    await authStatusCommand();
  });

authCmd
  .command("login")
  .description("Login via browser")
  .option("--force", "Force re-login even if already authenticated")
  .action(async (opts) => {
    if (opts.force) clearConfigForced();
    await authLoginCommand();
  });

authCmd
  .command("status")
  .description("Show current auth status")
  .action(async () => {
    await authStatusCommand();
  });

authCmd
  .command("logout")
  .description("Logout")
  .action(() => {
    authLogoutCommand();
  });

// Backward compat: `talosd login` → `talosd auth login`
program
  .command("login")
  .description("Login via browser (alias for auth login)")
  .action(async () => {
    await authLoginCommand();
  });

// ── up ────────────────────────────────────────────────────

program
  .command("up")
  .description("Create or wake your sandbox and connect via SSH")
  .option("-p, --project <name>", "Project name", "default")
  .action(async (opts) => {
    await upCommand({ project: opts.project });
  });

// ── ssh-proxy ─────────────────────────────────────────────
// Used as SSH ProxyCommand: SSH client spawns this to relay traffic via WebSocket

program
  .command("ssh-proxy")
  .description("SSH ProxyCommand relay — connect stdin/stdout to sandbox via WebSocket")
  .requiredOption("--project <name>", "Project name")
  .action(async (opts) => {
    await sshProxyCommand(opts.project);
  });

program.parse();

// Helper for --force
function clearConfigForced() {
  const { clearConfig } = require("./config/index.js");
  clearConfig();
}
