import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { registerModelRouteAdviceTool } from "./src/tool.ts";

export default function modelRoutingAdvisor(pi: ExtensionAPI): void {
  registerModelRouteAdviceTool(pi);
}
