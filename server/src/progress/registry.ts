/**
 * In-memory progress registry for sandbox operations.
 *
 * Tracks in-flight sandbox init/wake operations so that CLI clients
 * can subscribe to progress events via SSE.
 */

export interface ProgressEvent {
  step: number;
  totalSteps: number;
  stepName: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  message?: string;
  error?: string;
}

interface ActiveOperation {
  sandboxId: number;
  operationId: string;
  events: ProgressEvent[];
  status: "running" | "completed" | "failed";
  /** Listeners to notify on new events */
  listeners: Array<(event: ProgressEvent) => void>;
  doneListeners: Array<() => void>;
}

// In-memory registry keyed by operationId
const operations = new Map<string, ActiveOperation>();

let opCounter = 0;

/**
 * Register a new operation and return its operationId.
 */
export function registerOperation(sandboxId: number): string {
  const operationId = `op_${++opCounter}_${Date.now()}`;
  operations.set(operationId, {
    sandboxId,
    operationId,
    events: [],
    status: "running",
    listeners: [],
    doneListeners: [],
  });
  return operationId;
}

/**
 * Emit a progress event for an operation.
 * Notifies all active SSE listeners immediately.
 */
export function emitProgress(operationId: string, event: ProgressEvent): void {
  const op = operations.get(operationId);
  if (!op) return;
  op.events.push(event);
  for (const listener of op.listeners) {
    listener(event);
  }
}

/**
 * Mark an operation as completed.
 */
export function completeOperation(operationId: string, status: "completed" | "failed" = "completed"): void {
  const op = operations.get(operationId);
  if (!op) return;
  op.status = status;
  // Notify done listeners
  for (const listener of op.doneListeners) {
    listener();
  }
  // Clean up listeners (they will be re-attached on reconnect)
  op.listeners = [];
  op.doneListeners = [];
}

/**
 * Get an operation by ID. Returns null if not found.
 */
export function getOperation(operationId: string): ActiveOperation | null {
  return operations.get(operationId) ?? null;
}

/**
 * Subscribe to new events for an operation.
 * Returns an unsubscribe function.
 */
export function subscribe(
  operationId: string,
  onEvent: (event: ProgressEvent) => void,
  onDone: () => void
): () => void {
  const op = operations.get(operationId);
  if (!op) return () => {};

  op.listeners.push(onEvent);
  op.doneListeners.push(onDone);

  // If already completed, fire done immediately
  if (op.status !== "running") {
    onDone();
  }

  return () => {
    op.listeners = op.listeners.filter((l) => l !== onEvent);
    op.doneListeners = op.doneListeners.filter((l) => l !== onDone);
  };
}

/**
 * Get all replay events for an operation.
 */
export function getReplayEvents(operationId: string): ProgressEvent[] {
  const op = operations.get(operationId);
  return op?.events ?? [];
}

/**
 * Cleanup old completed operations (called periodically).
 */
export function cleanupStaleOperations(maxAgeMs: number = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, op] of operations) {
    if (op.status !== "running") {
      const lastEvent = op.events[op.events.length - 1];
      if (lastEvent) {
        // Rough heuristic: if the last event was emitted long ago, clean up
        // We don't store timestamps on events yet, so just check operation count
        // For now, keep last 100 completed operations
      }
    }
  }
  // Simple approach: keep only last 100 completed operations
  const completed = Array.from(operations.entries())
    .filter(([, op]) => op.status !== "running")
    .sort((a, b) => a[0].localeCompare(b[0]));
  while (completed.length > 100) {
    const [id] = completed.shift()!;
    operations.delete(id);
  }
}
