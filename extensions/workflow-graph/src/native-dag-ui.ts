import type { ExtensionCommandContext } from "@code-yeongyu/senpi";

export const NATIVE_DAG_UI_HOOK = "omo.workflow-graph.native-dag-ui.v1";

export type NativeDagUiRequest = {
  readonly args: string;
  readonly context: ExtensionCommandContext;
  readonly runId?: string;
  readonly sessionId: string;
};

type NativeDagUiHook = {
  readonly owner: "workflow-graph";
  readonly handle: (request: NativeDagUiRequest) => Promise<boolean>;
};

export function registerNativeDagUiHook(
  handle: NativeDagUiHook["handle"],
): (() => void) | undefined {
  const key = Symbol.for(NATIVE_DAG_UI_HOOK);
  if (Reflect.has(globalThis, key)) return undefined;
  const hook: NativeDagUiHook = { owner: "workflow-graph", handle };
  Reflect.set(globalThis, key, hook);
  return () => {
    if (Reflect.get(globalThis, key) === hook)
      Reflect.deleteProperty(globalThis, key);
  };
}
