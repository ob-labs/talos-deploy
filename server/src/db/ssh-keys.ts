import { getDb } from "./index.js";

export interface SshKey {
  id: number;
  user_id: number;
  public_key: string;
  name: string;
  created_at: string;
}

export function addSshKey(userId: number, publicKey: string, name: string = "default"): SshKey {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO ssh_keys (user_id, public_key, name) VALUES (?, ?, ?)"
  );
  const result = stmt.run(userId, publicKey, name);
  return findSshKeyById(result.lastInsertRowid as number)!;
}

export function findSshKeyById(id: number): SshKey | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM ssh_keys WHERE id = ?").get(id) as SshKey | undefined;
}

export function listSshKeys(userId: number): SshKey[] {
  const db = getDb();
  return db.prepare("SELECT * FROM ssh_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as SshKey[];
}

export function deleteSshKey(id: number, userId: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM ssh_keys WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function getUserPublicKeys(userId: number): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT public_key FROM ssh_keys WHERE user_id = ?").all(userId) as { public_key: string }[];
  return rows.map((r) => r.public_key);
}
