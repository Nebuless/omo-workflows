import {
  parseTargetSnapshot,
  serializeTargetSnapshot,
  type TargetSnapshot,
} from "./targets.ts";

export const APPROVAL_LIMITATION =
  "agent-mediated approval cannot prove approval origin";
export const APPROVAL_TTL_MS = 5 * 60_000;

export type ApprovalState =
  | "requested"
  | "confirmed"
  | "cancelled"
  | "used"
  | "expired";

export interface ApprovalBinding {
  readonly capabilityId: string;
  readonly correlationId: string;
  readonly parameters: string;
  readonly target: string;
}

export interface ApprovalRecord extends ApprovalBinding {
  readonly nonce: string;
  readonly expiresAtMs: number;
  readonly state: ApprovalState;
  readonly limitation: typeof APPROVAL_LIMITATION;
}

export interface ApprovalRequest {
  readonly capabilityId: string;
  readonly correlationId: string;
  readonly parameters: unknown;
  readonly target: TargetSnapshot;
}

export interface ApprovalRegistryOptions {
  readonly now?: () => number;
  readonly createNonce?: () => string;
  readonly ttlMs?: number;
}

function requireText(value: unknown, field: string, limit = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) {
    throw new Error(`${field} must be non-empty text.`);
  }
  return value;
}

function canonicalize(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value))
        throw new Error(
          "Approval parameters cannot contain non-finite numbers.",
        );
      return JSON.stringify(value);
    case "object":
      if (value === null) return "null";
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        throw new Error("Approval parameters must contain plain objects only.");
      }
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    default:
      throw new Error("Approval parameters must be JSON values.");
  }
}

function recordFor(
  nonce: string,
  binding: ApprovalBinding,
  expiresAtMs: number,
  state: ApprovalState,
): ApprovalRecord {
  return Object.freeze({
    ...binding,
    nonce,
    expiresAtMs,
    state,
    limitation: APPROVAL_LIMITATION,
  });
}

export function canonicalizeApprovalParameters(parameters: unknown): string {
  return canonicalize(parameters);
}

export function createApprovalBinding(
  request: ApprovalRequest,
): ApprovalBinding {
  return Object.freeze({
    capabilityId: requireText(request.capabilityId, "Capability ID"),
    correlationId: requireText(request.correlationId, "Correlation ID"),
    parameters: canonicalizeApprovalParameters(request.parameters),
    target: serializeTargetSnapshot(parseTargetSnapshot(request.target)),
  });
}

export class ApprovalRegistry {
  readonly #recordsByCorrelation = new Map<string, ApprovalRecord>();
  readonly #now: () => number;
  readonly #createNonce: () => string;
  readonly #ttlMs: number;
  #lastNowMs?: number;

  constructor(options: ApprovalRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createNonce = options.createNonce ?? crypto.randomUUID;
    this.#ttlMs = options.ttlMs ?? APPROVAL_TTL_MS;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1) {
      throw new Error("Approval TTL must be a positive integer.");
    }
  }

  request(request: ApprovalRequest): ApprovalRecord {
    const binding = createApprovalBinding(request);
    this.expire(binding.correlationId);
    const current = this.#recordsByCorrelation.get(binding.correlationId);
    if (
      current &&
      current.state !== "expired" &&
      current.state !== "cancelled" &&
      current.state !== "used"
    ) {
      throw new Error("Correlation ID already has an active approval request.");
    }
    const nonce = requireText(this.#createNonce(), "Approval nonce");
    const record = recordFor(
      nonce,
      binding,
      this.now() + this.#ttlMs,
      "requested",
    );
    this.#recordsByCorrelation.set(binding.correlationId, record);
    return record;
  }

  confirm(request: ApprovalRequest, nonce: string): ApprovalRecord {
    const record = this.requireMatching(request, nonce, "requested");
    const confirmed = recordFor(
      record.nonce,
      record,
      record.expiresAtMs,
      "confirmed",
    );
    this.#recordsByCorrelation.set(record.correlationId, confirmed);
    return confirmed;
  }

  cancel(request: ApprovalRequest, nonce: string): ApprovalRecord {
    const record = this.requireMatching(
      request,
      nonce,
      "requested",
      "confirmed",
    );
    const cancelled = recordFor(
      record.nonce,
      record,
      record.expiresAtMs,
      "cancelled",
    );
    this.#recordsByCorrelation.set(record.correlationId, cancelled);
    return cancelled;
  }

  consume(request: ApprovalRequest, nonce: string): ApprovalRecord {
    const record = this.requireMatching(request, nonce, "confirmed");
    const used = recordFor(record.nonce, record, record.expiresAtMs, "used");
    this.#recordsByCorrelation.set(record.correlationId, used);
    return used;
  }

  get(correlationId: string): ApprovalRecord | undefined {
    const normalized = requireText(correlationId, "Correlation ID");
    this.expire(normalized);
    return this.#recordsByCorrelation.get(normalized);
  }

  private now(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        "Approval clock must return a non-negative integer millisecond value.",
      );
    }
    if (this.#lastNowMs !== undefined && value < this.#lastNowMs) {
      throw new Error(
        "Approval clock drifted backward; approval use is rejected.",
      );
    }
    this.#lastNowMs = value;
    return value;
  }

  private expire(correlationId: string): void {
    const record = this.#recordsByCorrelation.get(correlationId);
    if (
      record &&
      record.state !== "used" &&
      record.state !== "cancelled" &&
      record.expiresAtMs <= this.now()
    ) {
      this.#recordsByCorrelation.set(
        correlationId,
        recordFor(record.nonce, record, record.expiresAtMs, "expired"),
      );
    }
  }

  private requireMatching(
    request: ApprovalRequest,
    nonce: string,
    ...states: ApprovalState[]
  ): ApprovalRecord {
    const binding = createApprovalBinding(request);
    const normalizedNonce = requireText(nonce, "Approval nonce");
    this.expire(binding.correlationId);
    const record = this.#recordsByCorrelation.get(binding.correlationId);
    if (!record || record.nonce !== normalizedNonce) {
      throw new Error("Approval nonce is not valid for this correlation ID.");
    }
    if (
      record.capabilityId !== binding.capabilityId ||
      record.parameters !== binding.parameters ||
      record.target !== binding.target
    ) {
      this.#recordsByCorrelation.set(
        record.correlationId,
        recordFor(record.nonce, record, record.expiresAtMs, "cancelled"),
      );
      throw new Error(
        "Approval binding changed: capability, parameters, or target drifted.",
      );
    }
    if (!states.includes(record.state)) {
      throw new Error(`Approval nonce is ${record.state} and cannot be used.`);
    }
    return record;
  }
}
