import { expect, test } from "bun:test";
import { join } from "node:path";
import { Type } from "typebox";
import { AssertError, Value } from "typebox/value";
import { fixture } from "./authoring-catalog-entry.test.ts";

const Catalog = Type.Object({
  revision: Type.Integer(),
  descriptors: Type.Array(
    Type.Object({
      key: Type.String(),
      title: Type.String(),
      digest: Type.String(),
    }),
    { minItems: 6 },
  ),
});

test("workflow recommendations accept exact catalog identity and preserve zero start", async () => {
  const f = await fixture();
  try {
    const listed = await f.call({ action: "list" });
    Value.Assert(Catalog, listed);
    const first = listed.descriptors[0];
    if (first === undefined) throw new Error("missing workflow descriptor");
    const proposal = {
      key: first.key,
      digest: first.digest,
      rationale: "fit",
      confidence: 0,
    };
    expect(
      await f.recommend({
        catalogRevision: listed.revision,
        proposals: [proposal],
      }),
    ).toEqual({
      kind: "recommended",
      catalogRevision: listed.revision,
      recommendations: [{ ...proposal, title: first.title }],
    });
    expect(f.extension.host.status()).toBeUndefined();
    expect(f.nativeDispatches).toEqual([]);
  } finally {
    await f.close();
  }
});

test.each([
  { name: "unknown key", patch: { key: "missing" } },
  { name: "mismatched digest", patch: { digest: "stale" } },
  { name: "blank rationale", patch: { rationale: " " } },
  { name: "control rationale", patch: { rationale: "bad\u0000control" } },
])(
  "rejects whole recommendation set when $name is invalid",
  async ({ patch }) => {
    // Given: two current identities; only the second proposal's named field changes.
    const f = await fixture();
    try {
      const listed = await f.call({ action: "list" });
      Value.Assert(Catalog, listed);
      const proposals = listed.descriptors
        .slice(0, 2)
        .map(({ key, digest }, index) => ({
          key,
          digest,
          rationale: "fit",
          confidence: 0.5,
          ...(index === 1 ? patch : {}),
        }));
      // When
      const result = await f.recommend({
        catalogRevision: listed.revision,
        proposals,
      });
      // Then: handler rejection, not a caught schema/runtime exception; no partial acceptance.
      expect(result).toEqual({
        kind: "rejected",
        reason: "Invalid workflow recommendations.",
      });
      expect(f.extension.host.status()).toBeUndefined();
      expect(f.callbacks).toEqual([]);
      expect(f.nativeDispatches).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

test.each([
  { name: "missing key", field: "key", value: undefined, keyword: "required" },
  { name: "empty key", field: "key", value: "", keyword: "minLength" },
  {
    name: "missing digest",
    field: "digest",
    value: undefined,
    keyword: "required",
  },
  { name: "empty digest", field: "digest", value: "", keyword: "minLength" },
  {
    name: "missing rationale",
    field: "rationale",
    value: undefined,
    keyword: "required",
  },
  {
    name: "empty rationale",
    field: "rationale",
    value: "",
    keyword: "minLength",
  },
  {
    name: "non-string rationale",
    field: "rationale",
    value: 42,
    keyword: "type",
  },
  {
    name: "long rationale",
    field: "rationale",
    value: "x".repeat(241),
    keyword: "maxLength",
  },
  {
    name: "NaN confidence",
    field: "confidence",
    value: Number.NaN,
    keyword: "type",
  },
  {
    name: "low confidence",
    field: "confidence",
    value: -0.1,
    keyword: "minimum",
  },
  {
    name: "high confidence",
    field: "confidence",
    value: 1.1,
    keyword: "maximum",
  },
])("rejects recommendation schema when $name is invalid", async (row) => {
  // Given: current revision/key/digest except the single field under test.
  const f = await fixture();
  try {
    const listed = await f.call({ action: "list" });
    Value.Assert(Catalog, listed);
    const first = listed.descriptors[0];
    if (first === undefined) throw new Error("missing workflow descriptor");
    const valid = {
      key: first.key,
      digest: first.digest,
      rationale: "fit",
      confidence: 0.5,
    };
    const proposal =
      row.value === undefined
        ? Object.fromEntries(
            Object.entries(valid).filter(([key]) => key !== row.field),
          )
        : { ...valid, [row.field]: row.value };
    // When
    const result = f.recommend({
      catalogRevision: listed.revision,
      proposals: [proposal],
    });
    // Then: exact schema error kind, keyword and field; unrelated exceptions must fail.
    await expect(result).rejects.toBeInstanceOf(AssertError);
    await expect(result).rejects.toMatchObject({
      cause: {
        source: "Assert",
        errors: [
          {
            keyword: row.keyword,
            instancePath:
              row.value === undefined
                ? "/proposals/0"
                : `/proposals/0/${row.field}`,
            ...(row.value === undefined
              ? { params: { requiredProperties: [row.field] } }
              : {}),
          },
        ],
      },
    });
    expect(f.extension.host.status()).toBeUndefined();
    expect(f.callbacks).toEqual([]);
    expect(f.nativeDispatches).toEqual([]);
  } finally {
    await f.close();
  }
});

test.each([
  { name: "duplicate keys", duplicate: true },
  { name: "stale revision", duplicate: false },
])("rejects whole recommendation set when $name", async ({ duplicate }) => {
  // Given: otherwise valid proposals; change either uniqueness or revision, never both.
  const f = await fixture();
  try {
    const listed = await f.call({ action: "list" });
    Value.Assert(Catalog, listed);
    const proposals = listed.descriptors.slice(0, 2).map(({ key, digest }) => ({
      key,
      digest,
      rationale: "fit",
      confidence: 0.5,
    }));
    // When
    const result = await f.recommend({
      catalogRevision: listed.revision - (duplicate ? 0 : 1),
      proposals: duplicate ? [proposals[0], proposals[0]] : proposals,
    });
    // Then
    expect(result).toEqual({
      kind: "rejected",
      reason: "Invalid workflow recommendations.",
    });
    expect(f.extension.host.status()).toBeUndefined();
    expect(f.callbacks).toEqual([]);
    expect(f.nativeDispatches).toEqual([]);
  } finally {
    await f.close();
  }
});

test.each([
  { count: 0, keyword: "minItems" },
  { count: 6, keyword: "maxItems" },
])(
  "rejects recommendation schema when proposal count is $count",
  async ({ count, keyword }) => {
    // Given: distinct current catalog identities, not six copies of one key.
    const f = await fixture();
    try {
      const listed = await f.call({ action: "list" });
      Value.Assert(Catalog, listed);
      const proposals = listed.descriptors
        .slice(0, count)
        .map(({ key, digest }) => ({
          key,
          digest,
          rationale: "fit",
          confidence: 0.5,
        }));
      // When
      const result = f.recommend({
        catalogRevision: listed.revision,
        proposals,
      });
      // Then
      await expect(result).rejects.toBeInstanceOf(AssertError);
      await expect(result).rejects.toMatchObject({
        cause: {
          source: "Assert",
          errors: [{ keyword, instancePath: "/proposals" }],
        },
      });
      expect(f.extension.host.status()).toBeUndefined();
      expect(f.callbacks).toEqual([]);
      expect(f.nativeDispatches).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

test("workflow program rejects incomplete start and unconfirmed transfer without native dispatch", async () => {
  const f = await fixture();
  try {
    const selection = {
      key: "destination",
      revision: 1,
      digest: `sha256:v1:${"a".repeat(64)}`,
    };
    expect(await f.call({ action: "start", inputs: {} })).toEqual({
      kind: "rejected",
      reason: "Start requires selection and inputs.",
    });
    expect(
      await f.call({
        action: "transfer",
        sourceRunId: "source-run",
        selection,
        manifest: {
          schemaVersion: 1,
          source: {
            runId: "source-run",
            workflowKey: "source-workflow",
            definitionFingerprint: "b".repeat(64),
            terminal: true,
          },
          destination: selection,
          artifacts: [
            {
              canonicalPath: "report.json",
              destination: "report.json",
              sha256: "c".repeat(64),
              size: 1,
              schemaId: "report",
            },
          ],
          mappings: [{ source: "/report", destination: "/input" }],
        },
        confirmed: false,
      }),
    ).toEqual({ kind: "rejected", reason: "transfer-confirmation-required" });
    expect(f.nativeDispatches).toEqual([]);
  } finally {
    await f.close();
  }
});

test("invalid native settings surface config diagnostics without losing builtins", async () => {
  const f = await fixture();
  try {
    await f.put(join(f.cwd, ".senpi/settings.json"), "{broken");
    expect(await f.call({ action: "list" })).toMatchObject({
      programs: expect.arrayContaining(["goal"]),
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "CONFIG_INVALID" }),
      ]),
    });
  } finally {
    await f.close();
  }
});

test("superseded catalog reload publishes only latest complete snapshot", async () => {
  // Given: one complete catalog publication.
  const f = await fixture();
  try {
    const before = await f.call({ action: "list" });
    Value.Assert(Catalog, before);
    // When: concurrent reloads supersede the older request before publication.
    const results = await Promise.all([
      f.call({ action: "reload" }),
      f.call({ action: "reload" }),
    ]);
    // Then: exactly one complete successor revision publishes; obsolete request rejects.
    expect(results[0]).toMatchObject({ kind: "rejected" });
    expect(results[1]).toEqual({ ...before, revision: before.revision + 1 });
  } finally {
    await f.close();
  }
});
