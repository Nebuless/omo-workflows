import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface ModelRef {
  readonly provider: string;
  readonly id: string;
}

export interface RecoveryRecord {
  readonly event:
    | "failure"
    | "recovery_action"
    | "continuation_admitted"
    | "outcome";
  readonly correlation: string;
  readonly at: string;
  readonly original: ModelRef;
  readonly fallback?: ModelRef;
  readonly rule: "collapse-repetition" | "repetitive-turns";
  readonly detectorMetadata: "rule-only";
  readonly outcome?: string;
}

export function journal(agentDir: string, identity: string) {
  const correlation = createHash("sha256").update(identity).digest("hex");
  const directory = join(agentDir, "logs", "repetition-recovery");
  const path = join(directory, `${correlation}.jsonl`);
  return {
    correlation,
    read(): RecoveryRecord | undefined {
      if (!existsSync(path)) return undefined;
      const line = readFileSync(path, "utf8").trim().split("\n").at(-1);
      if (!line)
        throw new Error(
          "Recovery journal is incomplete; automatic recovery held",
        );
      const value: unknown = JSON.parse(line);
      if (
        typeof value !== "object" ||
        value === null ||
        !("event" in value) ||
        !("original" in value) ||
        !("rule" in value)
      ) {
        throw new Error("Invalid recovery journal; automatic recovery held");
      }
      const original = value.original;
      if (
        typeof original !== "object" ||
        original === null ||
        !("provider" in original) ||
        !("id" in original) ||
        typeof original.provider !== "string" ||
        typeof original.id !== "string"
      ) {
        throw new Error("Invalid recovery model reference");
      }
      if (
        value.rule !== "collapse-repetition" &&
        value.rule !== "repetitive-turns"
      )
        throw new Error("Invalid recovery rule");
      const event = value.event;
      if (
        event !== "failure" &&
        event !== "recovery_action" &&
        event !== "continuation_admitted" &&
        event !== "outcome"
      )
        throw new Error("Invalid recovery event");
      const fallback = "fallback" in value ? value.fallback : undefined;
      if (
        fallback !== undefined &&
        (typeof fallback !== "object" ||
          fallback === null ||
          !("provider" in fallback) ||
          !("id" in fallback) ||
          typeof fallback.provider !== "string" ||
          typeof fallback.id !== "string")
      )
        throw new Error("Invalid fallback model reference");
      return {
        event,
        original: { provider: original.provider, id: original.id },
        rule: value.rule,
        correlation,
        at: "",
        detectorMetadata: "rule-only",
        ...(typeof fallback === "object" &&
        fallback !== null &&
        "provider" in fallback &&
        "id" in fallback &&
        typeof fallback.provider === "string" &&
        typeof fallback.id === "string"
          ? { fallback: { provider: fallback.provider, id: fallback.id } }
          : {}),
      };
    },
    claim(record: RecoveryRecord): boolean {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      let descriptor: number;
      try {
        descriptor = openSync(path, "wx", 0o600);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
          return false;
        throw error;
      }
      try {
        writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return true;
    },
    append(record: RecoveryRecord): void {
      appendFileSync(path, `${JSON.stringify(record)}\n`, {
        mode: 0o600,
        flush: true,
      });
    },
  };
}
