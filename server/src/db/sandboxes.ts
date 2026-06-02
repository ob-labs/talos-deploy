import { getDb } from "./index.js";

export interface Sandbox {
  id: number;
  user_id: number;
  project: string;
  sandboxclaim_name: string;
  status: "active" | "sleeping";
  last_active_at: string;
  created_at: string;
}

export function createSandbox(userId: number, project: string, claimName: string): Sandbox {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO sandboxes (user_id, project, sandboxclaim_name) VALUES (?, ?, ?)"
  );
  const result = stmt.run(userId, project, claimName);
  return findSandboxById(result.lastInsertRowid as number)!;
}

export function findSandboxById(id: number): Sandbox | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM sandboxes WHERE id = ?").get(id) as Sandbox | undefined;
}

export function findSandboxByUserAndProject(userId: number, project: string): Sandbox | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM sandboxes WHERE user_id = ? AND project = ?").get(userId, project) as Sandbox | undefined;
}

export function listUserSandboxes(userId: number): Sandbox[] {
  const db = getDb();
  return db.prepare("SELECT * FROM sandboxes WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Sandbox[];
}

export function listAllSandboxes(): Sandbox[] {
  const db = getDb();
  return db.prepare("SELECT * FROM sandboxes ORDER BY last_active_at DESC").all() as Sandbox[];
}

export function listActiveSandboxes(): Sandbox[] {
  const db = getDb();
  return db.prepare("SELECT * FROM sandboxes WHERE status = 'active'").all() as Sandbox[];
}

export function updateSandboxStatus(id: number, status: Sandbox["status"]): void {
  const db = getDb();
  db.prepare("UPDATE sandboxes SET status = ? WHERE id = ?").run(status, id);
}

export function touchSandbox(id: number): void {
  const db = getDb();
  db.prepare("UPDATE sandboxes SET last_active_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteSandbox(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM sandboxes WHERE id = ?").run(id);
}
