#!/usr/bin/env node
import { Command } from "commander";
import { authLoginCommand, authStatusCommand, authLogoutCommand } from "./commands/auth.js";
import { upCommand } from "./commands/up.js";

const program = new Command();
program
  .name("tt")
  .description("Talos Portal CLI — sandbox environments for Claude Code")
  .version("0.2.0");

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

// Backward compat: `tt login` → `tt auth login`
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

program.parse();

// Helper for --force
function clearConfigForced() {
  const { clearConfig } = require("./config/index.js");
  clearConfig();
}
