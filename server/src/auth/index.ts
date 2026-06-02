import jwt from "jsonwebtoken";
import { FastifyRequest, FastifyReply } from "fastify";
import { findUserById } from "../db/users.js";

const JWT_SECRET: string = (() => {
  const val = process.env.JWT_SECRET;
  if (!val) {
    console.error("FATAL: JWT_SECRET environment variable is required");
    process.exit(1);
  }
  return val;
})();
const JWT_EXPIRY = "7d";

export interface TokenPayload {
  userId: number;
  email: string;
  role: "user" | "admin";
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // 1. Try cookie (browser)
  let token: string | undefined = (request as any).cookies?.talos_token;

  // 2. Fall back to Authorization header (CLI)
  if (!token) {
    const auth = request.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      token = auth.slice(7);
    }
  }

  if (!token) {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = findUserById(payload.userId);
    if (!user) {
      reply.status(401).send({ error: "User not found" });
      return;
    }
    request.user = payload;
  } catch {
    reply.status(401).send({ error: "Invalid token" });
  }
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(request, reply);
  if (reply.sent) return;
  if (request.user?.role !== "admin") {
    reply.status(403).send({ error: "Admin required" });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}
