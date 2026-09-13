import { parseGraphMessage, type GraphProjection } from "./contracts.ts";
import { createGraphProjection, reduceGraphMessage } from "./projection.ts";

export const EXTENSION_RPC_EVENT_CHANNEL = "senpi:extension-rpc-event";

export interface WorkflowGraphEventBus {
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface WorkflowGraphStore {
  get(): GraphProjection;
  subscribe(listener: (projection: GraphProjection) => void): () => void;
  reset(): void;
  dispose(): void;
}

export function createWorkflowGraphStore(
  events: WorkflowGraphEventBus,
): WorkflowGraphStore {
  let projection = createGraphProjection();
  const listeners = new Set<(current: GraphProjection) => void>();
  const unsubscribe = events.on(EXTENSION_RPC_EVENT_CHANNEL, (value) => {
    const message = parseGraphMessage(value);
    if (message === undefined) return;
    const next = reduceGraphMessage(projection, message);
    if (next === projection) return;
    projection = next;
    for (const listener of listeners) listener(projection);
  });

  return {
    get(): GraphProjection {
      return projection;
    },
    subscribe(listener: (current: GraphProjection) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset(): void {
      projection = createGraphProjection();
      for (const listener of listeners) listener(projection);
    },
    dispose(): void {
      unsubscribe();
      listeners.clear();
    },
  };
}
