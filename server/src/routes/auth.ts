import { FastifyInstance } from "fastify";
import { signToken, authMiddleware } from "../auth/index.js";
import { createUser, findUserByEmail, verifyPassword, User } from "../db/users.js";

const COOKIE_OPTS = {
  path: "/",
  maxAge: 7 * 24 * 60 * 60, // 7 days, matches JWT expiry
  sameSite: "lax" as const,
};

export async function authRoutes(app: FastifyInstance) {
  // ── Register ──────────────────────────────────────────

  app.post("/api/auth/register", async (request, reply) => {
    const { email, password, name } = request.body as any;
    if (!email || !password || !name) {
      return reply.status(400).send({ error: "name, email, and password are required" });
    }

    const existing = findUserByEmail(email);
    if (existing) {
      return reply.status(409).send({ error: "email already registered" });
    }

    const user = createUser(email, password, name);
    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    reply.setCookie("talos_token", token, COOKIE_OPTS);
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
    };
  });

  // ── Login ─────────────────────────────────────────────

  app.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body as any;
    if (!email || !password) {
      return reply.status(400).send({ error: "email and password required" });
    }

    const user: (User & { password_hash: string }) | undefined = findUserByEmail(email);
    if (!user) {
      return reply.status(401).send({ error: "invalid email or password" });
    }

    if (!verifyPassword(user as any, password)) {
      return reply.status(401).send({ error: "invalid email or password" });
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    reply.setCookie("talos_token", token, COOKIE_OPTS);
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
    };
  });

  // ── CLI Token (requires cookie auth, issues token for CLI) ──

  app.post("/api/auth/cli-token", { preHandler: authMiddleware }, async (request) => {
    const token = signToken({
      userId: request.user!.userId,
      email: request.user!.email,
      role: request.user!.role,
    });
    return { token };
  });

  // ── Status ────────────────────────────────────────────

  app.get("/api/auth/status", { preHandler: authMiddleware }, async (request) => {
    return { user: request.user };
  });

  // ── Logout ────────────────────────────────────────────

  app.post("/api/auth/logout", async (request, reply) => {
    reply.clearCookie("talos_token", { path: "/" });
    return { ok: true };
  });
}
