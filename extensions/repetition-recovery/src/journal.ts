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
    | "continuation_requested"
    | "continuation_admitted"
    | "outcome";
  readonly correlation: string;
  readonly at: string;
  readonly original: ModelRef;
  readonly fallback?: ModelRef;
  readonly rule: "collapse-repetition" | "repetitive-turns";
  readonly detectorMetadata: "rule-only";
  readonly outcome?: string;
  readonly restoration?:
    | "switch-pending"
    | "pending"
    | "restored"
    | "superseded"
    | "held";
  readonly boundaryId?: string;
  readonly selectionId?: string;
  readonly selectionActor?: string;
}

function normalize(record: RecoveryRecord): RecoveryRecord {
  const outcome = [
    "completed", // Legacy terminal claims remain spent.
    "settled",
    "aborted",
    "error",
    "engine-refused",
    "interrupted",
    "interrupted-or-not-admitted",
    "not-admitted",
    "repetition-recurred",
    "superseded",
    "pending-input",
    "fallback-invalid",
    "fallback-unavailable",
    "model-selection-failed",
    "model-selection-rejected",
    "unknown",
  ].find((value) => value === record.outcome);
  const actor = record.selectionActor;
  return {
    event: record.event,
    correlation: record.correlation,
    at: record.at,
    original: {
      provider: record.original.provider,
      id: record.original.id,
    },
    rule: record.rule,
    detectorMetadata: record.detectorMetadata,
    ...(record.fallback
      ? {
          fallback: {
            provider: record.fallback.provider,
            id: record.fallback.id,
          },
        }
      : {}),
    ...(outcome === undefined ? {} : { outcome }),
    ...(record.restoration === undefined
      ? {}
      : { restoration: record.restoration }),
    ...(record.boundaryId === undefined
      ? {}
      : { boundaryId: record.boundaryId }),
    ...(record.selectionId === undefined
      ? {}
      : { selectionId: record.selectionId }),
    ...(actor === undefined
      ? {}
      : {
          selectionActor: /^[a-f0-9]{64}$/.test(actor)
            ? actor
            : selectionActorDigest(actor),
        }),
  };
}

export function selectionActorDigest(actor: string): string {
  return createHash("sha256")
    .update(`repetition-recovery:${actor}`)
    .digest("hex");
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
        event !== "continuation_requested" &&
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
      const restoration =
        "restoration" in value ? value.restoration : undefined;
      if (
        restoration !== undefined &&
        restoration !== "switch-pending" &&
        restoration !== "pending" &&
        restoration !== "restored" &&
        restoration !== "superseded" &&
        restoration !== "held"
      )
        throw new Error("Invalid recovery restoration status");
      const outcome = "outcome" in value ? value.outcome : undefined;
      const boundaryId = "boundaryId" in value ? value.boundaryId : undefined;
      const selectionId =
        "selectionId" in value ? value.selectionId : undefined;
      const selectionActor =
        "selectionActor" in value ? value.selectionActor : undefined;
      if (
        (outcome !== undefined && typeof outcome !== "string") ||
        (boundaryId !== undefined && typeof boundaryId !== "string") ||
        (selectionId !== undefined && typeof selectionId !== "string") ||
        (selectionActor !== undefined && typeof selectionActor !== "string")
      )
        throw new Error("Invalid recovery ownership metadata");
      return normalize({
        event,
        original: { provider: original.provider, id: original.id },
        rule: value.rule,
        correlation,
        at: "at" in value && typeof value.at === "string" ? value.at : "",
        detectorMetadata: "rule-only",
        ...(typeof outcome === "string" ? { outcome } : {}),
        ...(restoration === undefined ? {} : { restoration }),
        ...(typeof boundaryId === "string" ? { boundaryId } : {}),
        ...(typeof selectionId === "string" ? { selectionId } : {}),
        ...(typeof selectionActor === "string" ? { selectionActor } : {}),
        ...(typeof fallback === "object" &&
        fallback !== null &&
        "provider" in fallback &&
        "id" in fallback &&
        typeof fallback.provider === "string" &&
        typeof fallback.id === "string"
          ? { fallback: { provider: fallback.provider, id: fallback.id } }
          : {}),
      });
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
        writeFileSync(descriptor, `${JSON.stringify(normalize(record))}\n`);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return true;
    },
    append(record: RecoveryRecord): void {
      appendFileSync(path, `${JSON.stringify(normalize(record))}\n`, {
        mode: 0o600,
        flush: true,
      });
    },
  };
}
