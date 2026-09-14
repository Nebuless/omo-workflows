import { createHash } from "node:crypto";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const CompositionMappingSchema = Type.Object(
  {
    source: Type.String({ minLength: 1 }),
    destination: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type CompositionMapping = Static<typeof CompositionMappingSchema>;

export const CompositionIdentitySchema = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    version: Type.Integer({ minimum: 1 }),
    digest: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type CompositionIdentity = Static<typeof CompositionIdentitySchema>;

export const CompositionSchema = Type.Object(
  {
    identity: CompositionIdentitySchema,
    mappings: Type.Array(CompositionMappingSchema),
    nativeNodeCount: Type.Integer({ minimum: 0, maximum: 64 }),
  },
  { additionalProperties: false },
);
export type Composition = Static<typeof CompositionSchema>;

export const MAX_NATIVE_NODES = 64;

export function compositionNamespace(index: number, key: string): string {
  if (!Number.isInteger(index) || index < 0)
    throw new Error("Invalid composition index.");
  if (!/^\P{Cc}+$/u.test(key)) throw new Error("Invalid composition key.");
  const sanitized = key
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!sanitized) throw new Error("Invalid composition key.");
  return `stage-${index}-${sanitized}`;
}

export function compositionDigest(
  identity: Omit<CompositionIdentity, "digest">,
  mappings: readonly CompositionMapping[],
): string {
  const bytes = JSON.stringify({ identity, mappings });
  return `sha256:v1:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function decodePointerToken(encoded: string): string | undefined {
  let token = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character !== "~") {
      token += character;
      continue;
    }
    const escapedToken = encoded[index + 1];
    if (escapedToken !== "0" && escapedToken !== "1") return undefined;
    token += escapedToken === "0" ? "~" : "/";
    index += 1;
  }
  return token;
}

export function rfc6901Lookup(
  value: unknown,
  pointer: string,
): { readonly found: boolean; readonly value?: unknown } {
  if (pointer === "") return { found: true, value };
  if (!pointer.startsWith("/")) return { found: false };
  let current: unknown = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = decodePointerToken(encoded);
    if (token === undefined) return { found: false };
    if (current !== null && typeof current === "object") {
      if (Array.isArray(current)) {
        if (!/^(0|[1-9][0-9]*)$/u.test(token)) return { found: false };
        const index = Number(token);
        if (index >= current.length) return { found: false };
        current = current[index];
      } else {
        if (!Object.hasOwn(current, token)) return { found: false };
        current = (current as Record<string, unknown>)[token];
      }
    } else return { found: false };
  }
  return { found: true, value: current };
}

export function validateComposition(input: unknown): Composition {
  if (!Value.Check(CompositionSchema, input))
    throw new Error("Invalid composition.");
  const composition = input;
  if (composition.nativeNodeCount > MAX_NATIVE_NODES)
    throw new Error("Composition exceeds native node limit.");
  const { digest, ...identity } = composition.identity;
  if (digest !== compositionDigest(identity, composition.mappings))
    throw new Error("Stale composition digest.");
  const pointers = new Set<string>();
  for (const mapping of composition.mappings) {
    if (pointers.has(mapping.destination))
      throw new Error("Duplicate composition destination.");
    pointers.add(mapping.destination);
  }
  return composition;
}

export function applyCompositionMapping(
  source: unknown,
  destination: unknown,
  mappings: readonly CompositionMapping[],
  schema: TSchema,
): unknown {
  const result =
    destination !== null && typeof destination === "object"
      ? structuredClone(destination)
      : {};
  for (const mapping of mappings) {
    const found = rfc6901Lookup(source, mapping.source);
    if (!found.found || found.value === null)
      throw new Error("Composition source is missing or null.");
    if (mapping.destination === "" || !mapping.destination.startsWith("/"))
      throw new Error("Invalid composition destination.");
    const tokens = mapping.destination
      .slice(1)
      .split("/")
      .map(decodePointerToken);
    let current = result;
    for (const [index, token] of tokens.entries()) {
      if (token === undefined)
        throw new Error("Invalid composition destination.");
      if (["__proto__", "constructor", "prototype"].includes(token))
        throw new Error("Dangerous composition destination.");
      if (
        Array.isArray(current) &&
        (!/^(0|[1-9][0-9]*)$/u.test(token) || Number(token) > current.length)
      )
        throw new Error("Invalid composition destination.");
      if (index === tokens.length - 1) {
        Reflect.set(current, token, structuredClone(found.value));
        break;
      }
      if (!Object.hasOwn(current, token))
        Reflect.set(
          current,
          token,
          /^(0|[1-9][0-9]*)$/u.test(tokens[index + 1] ?? "") ? [] : {},
        );
      const child: unknown = Reflect.get(current, token);
      if (child === null || typeof child !== "object")
        throw new Error("Invalid composition destination.");
      current = child;
    }
  }
  if (!Value.Check(schema, result))
    throw new Error("Composition destination fails schema validation.");
  return result;
}
