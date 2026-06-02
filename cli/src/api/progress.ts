import { EventSource } from "eventsource";
import { loadConfig, getPortalUrl } from "../config/index.js";

/**
 * Progress event from the server.
 */
export interface ProgressEvent {
  step: number;
  totalSteps: number;
  stepName: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  message?: string;
  error?: string;
}

/**
 * Subscribe to sandbox operation progress via SSE.
 *
 * @param sandboxId - The sandbox ID
 * @param operationId - The operation ID returned from POST /api/sandboxes
 * @param onProgress - Callback for each progress event
 * @param onDone - Callback when operation completes
 * @returns A cleanup function to close the SSE connection
 */
export function streamProgress(
  sandboxId: number,
  operationId: string,
  onProgress: (event: ProgressEvent) => void,
  onDone: () => void
): () => void {
  const config = loadConfig();
  const portalUrl = getPortalUrl();
  const url = `${portalUrl}/api/sandboxes/${sandboxId}/progress?operationId=${operationId}`;
  const token = config?.token ?? "";

  const es = new EventSource(url, {
    // Use custom fetch to inject Authorization header
    fetch: async (inputUrl, init) => {
      return globalThis.fetch(inputUrl, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      });
    },
  });

  es.addEventListener("progress", (e: MessageEvent) => {
    try {
      const event: ProgressEvent = JSON.parse(e.data);
      onProgress(event);
    } catch (err) {
      console.error("Failed to parse SSE progress event:", err);
    }
  });

  es.addEventListener("done", () => {
    es.close();
    onDone();
  });

  es.addEventListener("error", () => {
    // EventSource auto-reconnects. If the operation is done,
    // the server will replay events and send "done" on reconnect.
  });

  return () => {
    es.close();
  };
}
