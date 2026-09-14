import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const Strict = { additionalProperties: false } as const;
const Name = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9][a-z0-9-]*$",
});
const Text = Type.String({ minLength: 1, pattern: ".*\\S.*" });
const CapabilityName = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9][a-z0-9_-]*$",
});
const CapabilitySchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("skill"),
      Type.Literal("tool"),
      Type.Literal("hook"),
    ]),
    name: CapabilityName,
    description: Text,
    evidence: Text,
  },
  Strict,
);

export const RepoToExtensionInputSchema = Type.Object(
  {
    repository_url: Type.String({ minLength: 1 }),
    extension_name: Type.Optional(Name),
  },
  Strict,
);
export const RepositoryReportSchema = Type.Object(
  {
    repository_url: Text,
    source_path: Text,
    project_name: Name,
    summary: Text,
    languages: Type.Array(Text, { maxItems: 12 }),
    tooling: Type.Array(Text, { maxItems: 12 }),
    capabilities: Type.Array(CapabilitySchema, { maxItems: 24 }),
  },
  Strict,
);

export type RepoToExtensionInputs = Static<typeof RepoToExtensionInputSchema>;

export function parseRepositoryUrl(value: string): string | undefined {
  if (/\s|\\|%/u.test(value)) return undefined;
  const raw = /^https:\/\/([^/?#]+)(\/[^?#]*)?([?#].*)?$/iu.exec(value);
  if (!raw || raw[3] || raw[1].includes("@") || raw[1].endsWith(":"))
    return undefined;
  const rawSegments = (raw[2] ?? "").split("/").slice(1);
  if (rawSegments.some((segment) => segment === "." || segment === ".."))
    return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    /:\d+(?:\/|$)/u.test(value.slice(value.indexOf("//") + 2))
  )
    return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.includes(":") ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host)
  )
    return undefined;
  const segments = url.pathname.split("/").slice(1);
  if (segments.at(-1) === "") segments.pop();
  if (
    segments.length !== 2 ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  )
    return undefined;
  return `https://${host}/${segments.join("/")}`;
}
export type RepositoryReport = Static<typeof RepositoryReportSchema>;
type Capability = Static<typeof CapabilitySchema>;

export type ExtensionPlan = {
  readonly repository_url: string;
  readonly extension_name: string;
  readonly output_dir: string;
  readonly skills: readonly Pick<Capability, "name" | "description">[];
  readonly tools: readonly Pick<Capability, "name" | "description">[];
  readonly hooks: readonly {
    readonly event: "tool_call" | "tool_result" | "session_start";
    readonly name: string;
    readonly purpose: string;
  }[];
  readonly constraints: readonly string[];
};

function capabilityPlan(
  report: RepositoryReport,
  kind: Capability["kind"],
): readonly Pick<Capability, "name" | "description">[] {
  return report.capabilities
    .filter((item) => item.kind === kind)
    .map(({ name, description }) => ({ name, description }));
}

function hookPlan(report: RepositoryReport): ExtensionPlan["hooks"] {
  return report.capabilities
    .filter((item) => item.kind === "hook")
    .map(({ name, description }) => ({
      event: "tool_call" as const,
      name,
      purpose: description,
    }));
}

function nonBlankStrings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim() !== "")
    ? value
    : undefined;
}

export function extensionName(
  inputs: RepoToExtensionInputs,
  report: RepositoryReport,
): string {
  return inputs.extension_name ?? report.project_name;
}

export function extensionPlanSchema(
  report: RepositoryReport,
  name: string,
): TSchema {
  const skills = capabilityPlan(report, "skill");
  const tools = capabilityPlan(report, "tool");
  const hooks = hookPlan(report);
  return Type.Object(
    {
      repository_url: Type.Literal(report.repository_url),
      extension_name: Type.Literal(name),
      output_dir: Type.Literal(`extensions/${name}`),
      skills: Type.Tuple(
        skills.map(({ name: skillName, description }) =>
          Type.Object(
            {
              name: Type.Literal(skillName),
              description: Type.Literal(description),
            },
            Strict,
          ),
        ),
      ),
      tools: Type.Tuple(
        tools.map(({ name: toolName, description }) =>
          Type.Object(
            {
              name: Type.Literal(toolName),
              description: Type.Literal(description),
            },
            Strict,
          ),
        ),
      ),
      hooks: Type.Tuple(
        hooks.map(({ event, name: hookName, purpose }) =>
          Type.Object(
            {
              event: Type.Literal(event),
              name: Type.Literal(hookName),
              purpose: Type.Literal(purpose),
            },
            Strict,
          ),
        ),
      ),
      constraints: Type.Array(Text, { minItems: 1, maxItems: 8 }),
    },
    Strict,
  );
}

export function admittedExtensionPlan(
  value: unknown,
  report: RepositoryReport,
  name: string,
): ExtensionPlan | undefined {
  if (!Value.Check(extensionPlanSchema(report, name), value)) return undefined;
  if (value === null || typeof value !== "object" || !("constraints" in value))
    return undefined;
  const constraints = nonBlankStrings(value.constraints);
  return constraints === undefined
    ? undefined
    : {
        repository_url: report.repository_url,
        extension_name: name,
        output_dir: `extensions/${name}`,
        skills: capabilityPlan(report, "skill"),
        tools: capabilityPlan(report, "tool"),
        hooks: hookPlan(report),
        constraints,
      };
}

export type ExtensionVerification = {
  readonly repository_url: string;
  readonly extension_name: string;
  readonly output_dir: string;
  readonly passed: boolean;
  readonly commands: readonly string[];
  readonly findings: readonly string[];
};

export function admittedVerification(
  value: unknown,
  plan: ExtensionPlan,
): ExtensionVerification | undefined {
  if (!Value.Check(verificationSchema(plan), value)) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    !("passed" in value) ||
    !("commands" in value) ||
    !("findings" in value) ||
    typeof value.passed !== "boolean"
  )
    return undefined;
  const commands = nonBlankStrings(value.commands);
  const findings =
    nonBlankStrings(value.findings) ??
    (Array.isArray(value.findings) ? [] : undefined);
  return commands === undefined || findings === undefined
    ? undefined
    : {
        repository_url: plan.repository_url,
        extension_name: plan.extension_name,
        output_dir: plan.output_dir,
        passed: value.passed,
        commands,
        findings,
      };
}

export function buildManifestSchema(plan: ExtensionPlan): TSchema {
  const files = [
    "AGENTS.md",
    "README.md",
    "package.json",
    "src/index.ts",
    "src/tools.ts",
    ...plan.skills.map(({ name }) => `skills/${name}/SKILL.md`),
    `test/${plan.extension_name}.test.ts`,
  ];
  return Type.Object(
    {
      repository_url: Type.Literal(plan.repository_url),
      extension_name: Type.Literal(plan.extension_name),
      output_dir: Type.Literal(plan.output_dir),
      files: Type.Tuple(files.map((file) => Type.Literal(file))),
      skills: Type.Tuple(plan.skills.map(({ name }) => Type.Literal(name))),
      tools: Type.Tuple(plan.tools.map(({ name }) => Type.Literal(name))),
      hooks: Type.Tuple(plan.hooks.map(({ name }) => Type.Literal(name))),
    },
    Strict,
  );
}

export function verificationSchema(plan: ExtensionPlan): TSchema {
  return Type.Object(
    {
      repository_url: Type.Literal(plan.repository_url),
      extension_name: Type.Literal(plan.extension_name),
      output_dir: Type.Literal(plan.output_dir),
      passed: Type.Boolean(),
      commands: Type.Array(Text, { minItems: 1, maxItems: 8 }),
      findings: Type.Array(Text, { maxItems: 24 }),
    },
    Strict,
  );
}

export function checked<S extends TSchema>(
  schema: S,
  value: unknown,
): Static<S> | undefined {
  return Value.Check(schema, value) ? value : undefined;
}
