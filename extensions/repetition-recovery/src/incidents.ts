import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

interface Context {
  readonly agentDir: string;
  readonly sessionId: string;
  readonly entries: readonly {
    readonly id: string;
    readonly type: string;
    readonly customType?: string;
    readonly data?: unknown;
  }[];
}
interface Delta {
  readonly type: string;
  readonly contentIndex?: number;
  readonly delta?: string;
}
interface Message {
  readonly provider: string;
  readonly model: string;
  readonly content: readonly {
    readonly type: string;
    readonly id?: string;
    readonly name?: string;
  }[];
}

function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?(?:[\w-]*(?:token|password|secret|api[_-]?key)|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"\n]*(?:"|$)|'[^'\n]*(?:'|$)|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED]",
    );
}

export function createIncidentRecorder() {
  let sessionId: string | undefined;
  let seen = new Set<string>();
  let blocks = new Map<number, { type: string; text: string }>();
  let tools = new Map<
    string,
    { id: string; name: string; executed: boolean }
  >();
  let size = 0;
  let truncated = false;
  let model: { provider: string; id: string } | undefined;
  let last: string | undefined;
  const initialize = (ctx: Context) => {
    if (ctx.sessionId === sessionId) return;
    sessionId = ctx.sessionId;
    seen = new Set(ctx.entries.map((entry) => entry.id));
    last = undefined;
  };
  return {
    start(ctx: Context): void {
      initialize(ctx);
      blocks = new Map();
      tools = new Map();
      size = 0;
      truncated = false;
      model = undefined;
    },
    delta(event: Delta, message: Message): void {
      if (
        event.delta === undefined ||
        event.contentIndex === undefined ||
        !["text_delta", "thinking_delta", "toolcall_delta"].includes(event.type)
      )
        return;
      model = { provider: message.provider, id: message.model };
      const part = message.content[event.contentIndex];
      if (
        part?.type === "toolCall" &&
        part.id &&
        part.name &&
        (tools.has(part.id) || tools.size < 40)
      )
        tools.set(part.id, {
          id: part.id.slice(0, 200),
          name: part.name.slice(0, 200),
          executed: tools.get(part.id)?.executed ?? false,
        });
      const available = Math.max(0, 16384 - size);
      const text = event.delta.slice(0, available);
      if (text.length < event.delta.length) truncated = true;
      size += text.length;
      const block = blocks.get(event.contentIndex);
      if (text)
        blocks.set(event.contentIndex, {
          type: event.type,
          text: (block?.text ?? "") + text,
        });
    },
    executed(id: string): void {
      const tool = tools.get(id);
      if (tool) tool.executed = true;
    },
    clear(): void {
      last = undefined;
    },
    latest(ctx: Context): string | undefined {
      return sessionId === ctx.sessionId ? last : undefined;
    },
    flush(ctx: Context): string | undefined {
      if (ctx.sessionId !== sessionId) {
        this.start(ctx);
        return undefined;
      }
      const activations = ctx.entries.filter(
        (entry) =>
          !seen.has(entry.id) &&
          entry.type === "custom" &&
          entry.customType === "rule-activation",
      );
      const relevant: { id: string; rules: string[]; remediation: string }[] =
        [];
      for (const entry of activations) {
        seen.add(entry.id);
        const data = entry.data;
        if (
          typeof data !== "object" ||
          data === null ||
          !("kind" in data) ||
          data.kind !== "ttsr" ||
          !("rules" in data) ||
          !Array.isArray(data.rules)
        )
          continue;
        const rules = data.rules
          .filter((rule): rule is string => typeof rule === "string")
          .slice(0, 20)
          .map((rule) => rule.slice(0, 200));
        if (rules.length)
          relevant.push({
            id: entry.id,
            rules,
            remediation:
              "remediation" in data && data.remediation === "provider-error"
                ? "provider-error"
                : "nudge",
          });
      }
      if (!relevant.length) return undefined;
      last = undefined;
      const identity = createHash("sha256")
        .update(`${ctx.sessionId}:${relevant.map((item) => item.id).join(":")}`)
        .digest("hex");
      const directory = join(
        ctx.agentDir,
        "logs",
        "repetition-recovery",
        "incidents",
      );
      for (const parent of [
        join(ctx.agentDir, "logs"),
        join(ctx.agentDir, "logs", "repetition-recovery"),
        directory,
      ]) {
        mkdirSync(parent, { recursive: true, mode: 0o700 });
        if (
          !lstatSync(parent).isDirectory() ||
          lstatSync(parent).isSymbolicLink()
        )
          throw new Error("Unsafe incident directory");
      }
      chmodSync(directory, 0o700);
      const path = join(directory, `${identity}.json`);
      const incident = {
        version: 1,
        at: new Date().toISOString(),
        session: createHash("sha256").update(ctx.sessionId).digest("hex"),
        activations: relevant.map((item) => item.id),
        rules: [...new Set(relevant.flatMap((item) => item.rules))],
        remediation: relevant.at(-1)?.remediation,
        detectorMetadata: "rule-only",
        model,
        message: {
          blocks: [...blocks.values()].map((block) => ({
            type: block.type,
            text: redact(block.text),
          })),
          tools: [...tools.values()].slice(0, 40),
          truncated,
          captured: model !== undefined,
        },
      };
      writeFileSync(path, `${JSON.stringify(incident)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      last = path;
      // ponytail: keep twenty bounded incidents; durable recovery claims are never pruned.
      const files = readdirSync(directory)
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => ({ name, stat: lstatSync(join(directory, name)) }))
        .filter((file) => file.stat.isFile())
        .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
      for (const file of files
        .filter((file) => file.name !== `${identity}.json`)
        .slice(19))
        unlinkSync(join(directory, file.name));
      return path;
    },
  };
}
