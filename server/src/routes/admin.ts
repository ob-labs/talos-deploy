import { FastifyInstance } from "fastify";
import { adminMiddleware } from "../auth/index.js";
import { listPendingUsers, listAllUsers, approveUser, rejectUser, findUserById } from "../db/users.js";
import { listAllSandboxes } from "../db/sandboxes.js";
import { getTokenUsage } from "../newapi/index.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/users", { preHandler: adminMiddleware }, async () => {
    return { users: listAllUsers() };
  });

  app.get("/api/admin/pending-users", { preHandler: adminMiddleware }, async () => {
    return { users: listPendingUsers() };
  });

  app.put("/api/admin/users/:id/approve", { preHandler: adminMiddleware }, async (request, reply) => {
    const id = Number((request.params as any).id);
    let apiKey: string | undefined;
    try {
      apiKey = await import("../newapi/index.js").then((m) =>
        m.createToken(`user-${id}`)
      );
    } catch (err: any) {
      console.warn(`Failed to create New API token for user ${id}: ${err.message}`);
    }
    const user = approveUser(id, apiKey || "");
    if (!apiKey) {
      return reply.status(207).send({
        user,
        warning: "User approved but API key creation failed. Please configure NEWAPI_ADMIN_TOKEN and create the key manually.",
      });
    }
    return { user };
  });

  app.put("/api/admin/users/:id/reject", { preHandler: adminMiddleware }, async (request) => {
    const id = Number((request.params as any).id);
    const user = rejectUser(id);
    return { user };
  });

  app.get("/api/admin/sandboxes", { preHandler: adminMiddleware }, async () => {
    const sandboxes = listAllSandboxes();
    // Enrich with user info
    const enriched = sandboxes.map((sb) => {
      const user = findUserById(sb.user_id);
      return {
        ...sb,
        user_name: user?.name ?? "",
        user_email: user?.email ?? "",
      };
    });
    return { sandboxes: enriched };
  });

  app.get("/api/admin/usage", { preHandler: adminMiddleware }, async () => {
    const users = listAllUsers().filter((u) => u.api_key);
    const usage = await Promise.all(
      users.map(async (u) => {
        try {
          const usage = await getTokenUsage(u.api_key!);
          return { userId: u.id, name: u.name, ...usage };
        } catch (err: any) {
          console.error(`Failed to get usage for user ${u.id} (${u.name}):`, err.message);
          return { userId: u.id, name: u.name, used: 0, remain: 0, error: "unavailable" };
        }
      })
    );
    return { usage };
  });
}
