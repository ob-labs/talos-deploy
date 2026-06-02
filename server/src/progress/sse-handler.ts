/**
 * Fastify SSE handler for streaming sandbox operation progress.
 *
 * Endpoint: GET /api/sandboxes/:id/progress?operationId=xxx
 *
 * Streams progress events in SSE format:
 *   event: progress
 *   data: {...}
 *
 *   event: done
 *   data: {}
 */

import { FastifyInstance } from "fastify";
import { authMiddleware } from "../auth/index.js";
import {
  getOperation,
  getReplayEvents,
  subscribe,
  ProgressEvent,
} from "./registry.js";

export async function progressRoutes(app: FastifyInstance) {
  app.get("/api/sandboxes/:id/progress", { preHandler: authMiddleware }, async (request, reply) => {
    const sandboxId = Number((request.params as any).id);
    const operationId = (request.query as any)?.operationId as string;

    if (!operationId) {
      return reply.status(400).send({ error: "operationId query parameter required" });
    }

    const op = getOperation(operationId);
    if (!op || op.sandboxId !== sandboxId) {
      return reply.status(404).send({ error: "Operation not found" });
    }

    // Set up SSE response
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Helper to write SSE events
    const writeEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Replay past events
    const pastEvents = getReplayEvents(operationId);
    for (const evt of pastEvents) {
      writeEvent("progress", evt);
    }

    // If already completed, send done and close
    if (op.status !== "running") {
      writeEvent("done", { sandboxId, status: op.status });
      reply.raw.end();
      return;
    }

    // Subscribe to new events
    const unsubscribe = subscribe(
      operationId,
      (evt: ProgressEvent) => {
        writeEvent("progress", evt);
      },
      () => {
        writeEvent("done", { sandboxId, status: op.status });
        reply.raw.end();
      }
    );

    // Handle client disconnect
    request.raw.on("close", () => {
      unsubscribe();
    });

    // Don't call reply.send() — we're managing the raw stream
    return;
  });
}
