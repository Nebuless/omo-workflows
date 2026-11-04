import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { connect } from "node:net";
import { Type } from "typebox";
import {
  boundedHerdrOutput,
  MAX_OUTPUT_BYTES,
  type HerdrRunResult,
  type HerdrRunner,
} from "./runner.ts";

type CoreReader = (
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<HerdrRunResult>;

/** Connect only to an explicit existing endpoint; never invoke hc's auto-start. */
export function readExistingCore(
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  endpoint = process.env.HC_SOCKET || process.env.HC_TERMINAL_SOCKET,
): Promise<HerdrRunResult> {
  if (!endpoint)
    return Promise.reject(
      new Error(
        "Set HC_SOCKET to the existing core endpoint before inspection.",
      ),
    );
  return new Promise((resolve, reject) => {
    const socket = connect({ path: endpoint, signal });
    const chunks: Buffer[] = [];
    let size = 0;
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`,
      ),
    );
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length;
      chunks.push(
        chunk.subarray(
          0,
          Math.max(0, MAX_OUTPUT_BYTES + 1 - (size - chunk.length)),
        ),
      );
      const newline = chunk.includes(10);
      if (size > MAX_OUTPUT_BYTES) {
        resolve({ exitCode: 0, ...boundedHerdrOutput(chunks, true) });
        socket.destroy();
      } else if (newline) {
        try {
          const reply = JSON.parse(
            Buffer.concat(chunks).toString("utf8").split("\n")[0],
          );
          if (
            reply.jsonrpc !== "2.0" ||
            reply.id !== 1 ||
            !("result" in reply || "error" in reply)
          )
            throw new Error("Invalid core response.");
          resolve({
            exitCode: reply.error ? 1 : 0,
            ...boundedHerdrOutput([
              Buffer.from(JSON.stringify(reply.error ?? reply.result)),
            ]),
          });
        } catch (error) {
          reject(error);
        }
        socket.destroy();
      }
    });
    socket.once("close", () =>
      reject(new Error("Core connection closed before a complete response.")),
    );
  });
}

const actions = [
  "app-list",
  "app-status",
  "app-commands",
  "core-list",
  "core-get",
  "core-read",
  "core-templates",
] as const;
const parameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("app-list"),
      Type.Literal("app-status"),
      Type.Literal("app-commands"),
      Type.Literal("core-list"),
      Type.Literal("core-get"),
      Type.Literal("core-read"),
      Type.Literal("core-templates"),
    ]),
    terminalId: Type.Optional(
      Type.String({ pattern: "^t[0-9]+$", maxLength: 64 }),
    ),
  },
  { additionalProperties: false },
);

/** Current desktop IDs and API are separate from legacy workspace/pane tools. */
export function registerHerdrDesktopTools(
  pi: Pick<ExtensionAPI, "registerTool">,
  run: HerdrRunner,
  readCore: CoreReader = readExistingCore,
): void {
  pi.registerTool({
    name: "herdr_desktop",
    label: "Inspect Herdr Desktop",
    description:
      "Read current herdr-app layout or hc terminal state/output. No terminal input, launch, or desktop mutation.",
    parameters,
    async execute(_id, input, signal) {
      try {
        const { action, terminalId } = input;
        if (
          !actions.includes(action) ||
          Object.keys(input).some(
            (key) => key !== "action" && key !== "terminalId",
          )
        )
          throw new Error("Unknown desktop inspection input.");
        const targeted = action === "core-get" || action === "core-read";
        if (
          targeted
            ? !terminalId || !/^t[0-9]+$/u.test(terminalId)
            : terminalId !== undefined
        )
          throw new Error(
            "Only core-get/core-read require a local terminal ID returned by core-list.",
          );
        const app = action.startsWith("app-");
        const binary = app ? "herdr-app" : "hc";
        const boundedSignal = AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(5000),
        ]);
        const version = await run([binary, "--version"], boundedSignal);
        const expected = app ? ["0.1.13"] : ["0.1.14", "0.1.18"];
        if (
          version.exitCode !== 0 ||
          version.truncated ||
          !expected.includes(
            version.output.match(/\b\d+\.\d+\.\d+\b/u)?.[0] ?? "",
          )
        )
          throw new Error(
            `Desktop inspection requires verified ${binary} ${expected.join(" or ")}; installed version is unavailable or unverified.`,
          );
        const target = terminalId ?? "";
        const result = app
          ? await run(
              [
                binary,
                action === "app-list"
                  ? "ls"
                  : action === "app-status"
                    ? "status"
                    : "commands",
              ],
              boundedSignal,
            )
          : await readCore(
              action === "core-list"
                ? "terminal.list"
                : action === "core-templates"
                  ? "templates.list"
                  : action === "core-read"
                    ? "terminal.read"
                    : "terminal.get",
              targeted
                ? {
                    terminal: target,
                    ...(action === "core-read" ? { lines: 0 } : {}),
                  }
                : {},
              boundedSignal,
            );
        const details = {
          ...result,
          status:
            result.exitCode === 0 && !result.truncated
              ? "completed"
              : "unknown",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
        };
      } catch (error) {
        const details = {
          status: "unavailable",
          output:
            error instanceof Error
              ? error.message
              : "Desktop inspection failed.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
        };
      }
    },
  });
}
