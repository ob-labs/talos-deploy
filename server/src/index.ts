import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { WebSocketServer } from "ws";
import path from "path";
import { getDb } from "./db/index.js";
import { ensureAdmin } from "./db/users.js";
import { authRoutes } from "./routes/auth.js";
import { sshKeyRoutes } from "./routes/ssh-keys.js";
import { sandboxRoutes } from "./routes/sandboxes.js";
import { adminRoutes } from "./routes/admin.js";
import { progressRoutes } from "./progress/sse-handler.js";
import { startIdleChecker } from "./scheduler/idle-checker.js";
import { ensureNewApiChannel } from "./newapi/index.js";

const PORT = Number(process.env.PORT) || 8080;
const ADMIN_EMAIL: string = (() => {
  const val = process.env.ADMIN_EMAIL;
  if (!val) {
    console.error("FATAL: ADMIN_EMAIL environment variable is required");
    process.exit(1);
  }
  return val;
})();
const ADMIN_PASSWORD: string = (() => {
  const val = process.env.ADMIN_PASSWORD;
  if (!val) {
    console.error("FATAL: ADMIN_PASSWORD environment variable is required");
    process.exit(1);
  }
  return val;
})();

async function main() {
  // Initialize DB
  getDb();

  // Ensure admin user exists
  const admin = ensureAdmin(ADMIN_EMAIL, ADMIN_PASSWORD, "Admin");
  console.log(`Admin user: ${admin.email} (id=${admin.id})`);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(cookie);

  // Attach WebSocket server to Fastify's HTTP server for SSH relay
  const wss = new WebSocketServer({ noServer: true });
  app.server.on("upgrade", (request, socket, head) => {
    const url = request.url || "/";
    const match = url.match(/^\/api\/sandboxes\/(\d+)\/ssh$/);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as any).__sandboxId = Number(match[1]);
      wss.emit("connection", ws, request);
    });
  });

  // Handle WebSocket connections for SSH relay
  wss.on("connection", (ws, request) => {
    import("./routes/sandboxes-ssh.js").then(({ handleSshRelay }) => {
      handleSshRelay(ws, request);
    });
  });

  // Routes
  await app.register(authRoutes);
  await app.register(sshKeyRoutes);
  await app.register(sandboxRoutes);
  await app.register(adminRoutes);
  await app.register(progressRoutes);

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  // Start idle checker
  startIdleChecker();

  // Serve static dashboard (must be after API routes)
  const webDir = path.join(process.cwd(), "dist/web");
  const fastifyStatic = (await import("@fastify/static")).default;
  await app.register(fastifyStatic, {
    root: webDir,
    prefix: "/",
    wildcard: false,
  });
  // SPA fallback
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.type("text/html").send(require("fs").readFileSync(path.join(webDir, "index.html")));
    }
    return reply.code(404).send({ error: "not found" });
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Talos Portal running on :${PORT}`);

  // Init new-api upstream channel in background (new-api may not be ready immediately)
  (async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      try {
        await ensureNewApiChannel();
        return;
      } catch (e: any) {
        console.warn(`new-api channel init attempt ${attempt + 1} failed: ${e.message}`);
      }
    }
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
