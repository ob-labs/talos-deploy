import { FastifyInstance } from "fastify";
import { authMiddleware } from "../auth/index.js";
import { addSshKey, listSshKeys, deleteSshKey } from "../db/ssh-keys.js";

export async function sshKeyRoutes(app: FastifyInstance) {
  app.post("/api/ssh-keys", { preHandler: authMiddleware }, async (request, reply) => {
    const { public_key, name } = request.body as any;
    if (!public_key) return reply.status(400).send({ error: "public_key required" });
    const key = addSshKey(request.user!.userId, public_key, name);
    return { key };
  });

  app.get("/api/ssh-keys", { preHandler: authMiddleware }, async (request) => {
    return { keys: listSshKeys(request.user!.userId) };
  });

  app.delete("/api/ssh-keys/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = Number((request.params as any).id);
    const ok = deleteSshKey(id, request.user!.userId);
    if (!ok) return reply.status(404).send({ error: "not found" });
    return { ok: true };
  });
}
