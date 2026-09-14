import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DefaultPackageManager, SettingsManager } from "@code-yeongyu/senpi";
import { createJiti } from "jiti/static";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ComposedIdentitySchema } from "../execution/composed.ts";
import { CompositionMappingSchema } from "../execution/composition.ts";
import type { StagedProgram } from "../execution/policy.ts";

const ProgramMetadata = Type.Object({
  key: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
  input: Type.Object({}, { additionalProperties: true }),
  compositionIdentity: Type.Optional(ComposedIdentitySchema),
  transferArtifacts: Type.Optional(
    Type.Array(
      Type.Object(
        {
          canonicalPath: Type.String({ minLength: 1 }),
          destination: Type.String({ minLength: 1 }),
          schemaId: Type.String({ minLength: 1 }),
          schema: Type.Object({}, { additionalProperties: true }),
          mapping: CompositionMappingSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  ),
});
const isModule = (path: string) => /\.[cm]?[jt]s$/.test(path);
function clone<T>(value: T, seen = new WeakMap<object, object>()): T {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value))
    Reflect.set(copy, key, clone(value[key as keyof T], seen));
  return copy as T;
}
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key as keyof T]);
  return Object.freeze(value);
}
const snapshotProgram = (program: StagedProgram): StagedProgram =>
  deepFreeze({ ...clone(program), decide: program.decide });
const moduleLoader = createJiti(import.meta.url, {
  moduleCache: false,
  tryNative: false,
});
const isInside = (root: string, path: string) => {
  const value = relative(root, path);
  return !isAbsolute(value) && value !== ".." && !value.startsWith("../");
};

export type ProgramSourceKind =
  | "settings-project"
  | "project-local"
  | "settings-global"
  | "user-global"
  | "package"
  | "bundled";
export type ProgramSource = {
  readonly key: string;
  readonly kind: ProgramSourceKind;
  readonly path?: string;
  readonly configuredName?: string;
};
export type WorkflowDescriptor = {
  readonly key: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly intents: readonly string[];
  readonly examples: readonly string[];
  readonly inputSummary: string;
  readonly source: "bundled" | "project" | "global" | "package";
  readonly digest: string;
};
type DescriptorProgram = {
  readonly key: string;
  readonly version: number;
  readonly metadata?: unknown;
};
export function workflowDescriptorDigest(
  kind: "authored" | "bundled",
  keyOrPath: string,
  bytesOrVersion: string | Uint8Array,
): string {
  const nul = "\0";
  const prefix =
    kind === "authored"
      ? `v1${nul}authored${nul}${keyOrPath}${nul}`
      : `v1${nul}bundled${nul}0.1.0${nul}ff55b141109e3f9f5980c1f0c718dea39f6b2fd9${nul}${keyOrPath}${nul}`;
  return `sha256:v1:${createHash("sha256").update(prefix, "utf8").update(bytesOrVersion).digest("hex")}`;
}
export function normalizeWorkflowDescriptor(
  program: DescriptorProgram,
  source: ProgramSourceKind,
  digest = workflowDescriptorDigest(
    "bundled",
    program.key,
    String(program.version),
  ),
): WorkflowDescriptor {
  const normalized =
    source === "bundled"
      ? "bundled"
      : source.includes("project")
        ? "project"
        : source.includes("global")
          ? "global"
          : "package";
  const metadata =
    program.metadata !== null && typeof program.metadata === "object"
      ? (program.metadata as Record<string, unknown>)
      : {};
  const hasControls = (value: string) =>
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return (
        code !== undefined &&
        (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f))
      );
    });
  if (hasControls(program.key) || program.key.length > 120)
    throw new Error("Invalid workflow descriptor metadata.");
  const fallbackKey = program.key;
  const text = (value: unknown, fallback: string, limit = 240) =>
    value === undefined
      ? fallback.slice(0, limit)
      : typeof value === "string" && !hasControls(value)
        ? value.slice(0, limit)
        : (() => {
            throw new Error("Invalid workflow descriptor metadata.");
          })();
  const list = (value: unknown) =>
    value === undefined
      ? []
      : Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value.map((item) => text(item, "")).filter(Boolean)
        : (() => {
            throw new Error("Invalid workflow descriptor metadata.");
          })();
  return {
    key: program.key,
    version: program.version,
    title: text(metadata.title, fallbackKey, 120),
    description: text(
      metadata.description,
      `Workflow program ${fallbackKey}.`,
      240,
    ),
    intents: list(metadata.intents),
    examples: list(metadata.examples),
    inputSummary: text(
      metadata.inputSummary,
      "JSON object accepted by the program input schema.",
    ),
    source: normalized,
    digest,
  };
}

export type ProgramDiagnostic = {
  readonly code:
    | "CONFIG_INVALID"
    | "DUPLICATE_KEY"
    | "IMPORT_FAILED"
    | "INVALID_PROGRAM"
    | "PATH_NOT_FOUND"
    | "UNTRUSTED_PATH";
  readonly source: string;
  readonly message: string;
};
export type ProgramPaths = readonly string[] | Readonly<Record<string, string>>;
export type CatalogSnapshot = {
  readonly revision: number;
  readonly programs: {
    readonly get: (key: string) => StagedProgram | undefined;
    readonly has: (key: string) => boolean;
  };
  readonly list: readonly string[];
  readonly sources: readonly ProgramSource[];
  readonly descriptors: readonly WorkflowDescriptor[];
  readonly diagnostics: readonly ProgramDiagnostic[];
};

export type ProgramCatalogOptions = {
  readonly cwd: string;
  readonly agentDir: string;
  readonly settingsProject?: ProgramPaths;
  readonly settingsGlobal?: ProgramPaths;
  readonly package?: ProgramPaths;
  readonly globalPackage?: ProgramPaths;
  readonly installedPackages?: readonly {
    readonly root: string;
    readonly paths: ProgramPaths;
    readonly scope: "project" | "user";
  }[];
  readonly bundled: (artifactRoot: string) => readonly StagedProgram[];
  readonly diagnostics?: readonly ProgramDiagnostic[];
};
type TrustedContext = { readonly cwd: string; isProjectTrusted(): boolean };
type Candidate = { readonly path: string; readonly configuredName?: string };

function entries(paths: ProgramPaths | undefined): Candidate[] {
  if (paths === undefined) return [];
  return Array.isArray(paths)
    ? paths.map((path) => ({ path }))
    : Object.entries(paths).map(([configuredName, path]) => ({
        path,
        configuredName,
      }));
}

export function createProgramCatalog(options: ProgramCatalogOptions) {
  const bundled = options.bundled("");
  let programs = new Map(
    bundled.map((program) => [program.key, snapshotProgram(program)]),
  );
  const initialPrograms = new Map(programs);
  let snapshot: CatalogSnapshot = Object.freeze({
    revision: 0,
    programs: Object.freeze({
      get: (key: string) => initialPrograms.get(key),
      has: (key: string) => initialPrograms.has(key),
    }),
    list: Object.freeze([...initialPrograms.keys()]),
    sources: Object.freeze(
      [...programs.keys()].map((key) =>
        Object.freeze({ key, kind: "bundled" as const }),
      ),
    ),
    descriptors: Object.freeze(
      bundled.map((program) => {
        const descriptor = normalizeWorkflowDescriptor(program, "bundled");
        return Object.freeze({
          ...descriptor,
          intents: Object.freeze([...descriptor.intents]),
          examples: Object.freeze([...descriptor.examples]),
        });
      }),
    ),
    diagnostics: Object.freeze([]),
  });
  let sourceList = snapshot.sources;
  let diagnosticList = snapshot.diagnostics;
  let descriptorList = snapshot.descriptors;
  let reloadGeneration = 0;
  const load = async (
    candidate: Candidate,
    kind: ProgramSourceKind,
    root: string | undefined,
    next: Map<string, StagedProgram>,
    nextSources: ProgramSource[],
    nextDiagnostics: ProgramDiagnostic[],
    descriptors: WorkflowDescriptor[],
  ): Promise<void> => {
    const requested = candidate.path;
    let file: string;
    try {
      file = await realpath(requested);
    } catch {
      nextDiagnostics.push({
        code: "PATH_NOT_FOUND",
        source: requested,
        message: `Workflow module not found: ${requested}`,
      });
      return;
    }
    if (!isModule(file)) return;
    if (root !== undefined && !isInside(await realpath(root), file)) {
      nextDiagnostics.push({
        code: "UNTRUSTED_PATH",
        source: requested,
        message: `Workflow module escapes trusted ${kind} root.`,
      });
      return;
    }
    let loaded: unknown;
    let digest: string;
    try {
      const bytes = await readFile(file);
      digest = workflowDescriptorDigest("authored", file, bytes);
      // Execute captured bytes, never a native reread; keep canonical import resolution.
      loaded = moduleLoader.evalModule(bytes.toString("utf8"), {
        filename: file,
        forceTranspile: true,
      });
    } catch (error) {
      nextDiagnostics.push({
        code: "IMPORT_FAILED",
        source: file,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (
      loaded === null ||
      typeof loaded !== "object" ||
      !("program" in loaded)
    ) {
      nextDiagnostics.push({
        code: "INVALID_PROGRAM",
        source: file,
        message: "Authored module must export program.",
      });
      return;
    }
    const program = loaded.program;
    if (
      !Value.Check(ProgramMetadata, program) ||
      !("decide" in program) ||
      typeof program.decide !== "function"
    ) {
      nextDiagnostics.push({
        code: "INVALID_PROGRAM",
        source: file,
        message: "Invalid authored workflow export.",
      });
      return;
    }
    if (next.has(program.key)) {
      nextDiagnostics.push({
        code: "DUPLICATE_KEY",
        source: file,
        message: `${kind} program "${program.key}" skipped by precedence.`,
      });
      return;
    }
    const decide = program.decide.bind(program);
    descriptors.push(normalizeWorkflowDescriptor(program, kind, digest));
    next.set(
      program.key,
      snapshotProgram({
        key: program.key,
        version: program.version,
        input: program.input,
        ...(program.compositionIdentity === undefined
          ? {}
          : { compositionIdentity: program.compositionIdentity }),
        ...(program.transferArtifacts === undefined
          ? {}
          : { transferArtifacts: program.transferArtifacts }),
        decide,
      }),
    );
    nextSources.push({
      key: program.key,
      kind,
      path: file,
      ...(candidate.configuredName === undefined
        ? {}
        : { configuredName: candidate.configuredName }),
    });
  };
  const loadPaths = async (
    paths: ProgramPaths | undefined,
    kind: ProgramSourceKind,
    base: string,
    root: string | undefined,
    next: Map<string, StagedProgram>,
    nextSources: ProgramSource[],
    nextDiagnostics: ProgramDiagnostic[],
    descriptors: WorkflowDescriptor[],
    missing = true,
  ) => {
    for (const candidate of entries(paths)) {
      const path = isAbsolute(candidate.path)
        ? candidate.path
        : resolve(base, candidate.path);
      let directory = false;
      try {
        directory = (await lstat(path)).isDirectory();
      } catch {
        /* load reports missing */
      }
      if (!directory) {
        if (missing)
          await load(
            { ...candidate, path },
            kind,
            root,
            next,
            nextSources,
            nextDiagnostics,
            descriptors,
          );
        continue;
      }
      for (const name of (await readdir(path)).sort()) {
        const file = join(path, name);
        const info = await lstat(file);
        if (info.isFile() || info.isSymbolicLink())
          await load(
            { path: file, configuredName: candidate.configuredName },
            kind,
            root,
            next,
            nextSources,
            nextDiagnostics,
            descriptors,
          );
      }
    }
  };
  return {
    snapshot: () => snapshot,
    list: () => [...snapshot.list],
    get: (key: string, artifactRoot: string) =>
      sourceList.find((source) => source.key === key)?.kind === "bundled"
        ? options.bundled(artifactRoot).find((program) => program.key === key)
        : programs.get(key),
    requiresExplicitResume: (key: string) =>
      sourceList.find((source) => source.key === key)?.kind !== "bundled",
    sources: () => sourceList as readonly ProgramSource[],
    diagnostics: () => diagnosticList as readonly ProgramDiagnostic[],
    descriptors: () => descriptorList as readonly WorkflowDescriptor[],
    async reload(context: Pick<TrustedContext, "isProjectTrusted">) {
      const generation = ++reloadGeneration;
      const next = new Map<string, StagedProgram>();
      const pendingDescriptors: WorkflowDescriptor[] = [];
      const nextSources: ProgramSource[] = [];
      const nextDiagnostics: ProgramDiagnostic[] = [
        ...(options.diagnostics ?? []),
      ];
      if (context.isProjectTrusted()) {
        await loadPaths(
          options.settingsProject,
          "settings-project",
          options.cwd,
          options.cwd,
          next,
          nextSources,
          nextDiagnostics,
          pendingDescriptors,
        );
        await loadPaths(
          [join(options.cwd, ".omo", "workflows")],
          "project-local",
          options.cwd,
          options.cwd,
          next,
          nextSources,
          nextDiagnostics,
          pendingDescriptors,
          false,
        );
      }
      await loadPaths(
        options.settingsGlobal,
        "settings-global",
        options.agentDir,
        options.agentDir,
        next,
        nextSources,
        nextDiagnostics,
        pendingDescriptors,
      );
      await loadPaths(
        [join(options.agentDir, "workflows")],
        "user-global",
        options.agentDir,
        options.agentDir,
        next,
        nextSources,
        nextDiagnostics,
        pendingDescriptors,
        false,
      );
      // Explicit package resources inherit the trust and base directory of their settings scope.
      if (context.isProjectTrusted())
        await loadPaths(
          options.package,
          "package",
          options.cwd,
          options.cwd,
          next,
          nextSources,
          nextDiagnostics,
          pendingDescriptors,
        );
      await loadPaths(
        options.globalPackage,
        "package",
        options.agentDir,
        options.agentDir,
        next,
        nextSources,
        nextDiagnostics,
        pendingDescriptors,
      );
      for (const pkg of options.installedPackages ?? []) {
        if (pkg.scope === "project" && !context.isProjectTrusted()) continue;
        await loadPaths(
          pkg.paths,
          "package",
          pkg.root,
          pkg.root,
          next,
          nextSources,
          nextDiagnostics,
          pendingDescriptors,
        );
      }
      for (const program of options.bundled("")) {
        if (next.has(program.key))
          nextDiagnostics.push({
            code: "DUPLICATE_KEY",
            source: program.key,
            message: `bundled program "${program.key}" skipped by precedence.`,
          });
        else {
          next.set(program.key, snapshotProgram(program));
          nextSources.push({ key: program.key, kind: "bundled" });
        }
      }
      if (generation !== reloadGeneration) return;
      const publishedPrograms = new Map(next);
      programs = publishedPrograms;
      sourceList = nextSources;
      diagnosticList = nextDiagnostics;
      const descriptorsByKey = new Map<string, WorkflowDescriptor>();
      for (const descriptor of pendingDescriptors)
        descriptorsByKey.set(descriptor.key, descriptor);
      for (const program of options.bundled("")) {
        if (!descriptorsByKey.has(program.key))
          descriptorsByKey.set(
            program.key,
            normalizeWorkflowDescriptor(program, "bundled"),
          );
      }
      descriptorList = sourceList.flatMap((source) => {
        const descriptor = descriptorsByKey.get(source.key);
        return descriptor === undefined ? [] : [descriptor];
      });
      snapshot = Object.freeze({
        revision: snapshot.revision + 1,
        programs: Object.freeze({
          get: (key: string) => publishedPrograms.get(key),
          has: (key: string) => publishedPrograms.has(key),
        }),
        list: Object.freeze([...programs.keys()]),
        sources: Object.freeze(
          sourceList.map((source) => Object.freeze({ ...source })),
        ),
        descriptors: Object.freeze(
          descriptorList.map((descriptor) =>
            Object.freeze({
              ...descriptor,
              intents: Object.freeze([...descriptor.intents]),
              examples: Object.freeze([...descriptor.examples]),
            }),
          ),
        ),
        diagnostics: Object.freeze(
          diagnosticList.map((diagnostic) => Object.freeze({ ...diagnostic })),
        ),
      });
      sourceList = snapshot.sources;
      diagnosticList = snapshot.diagnostics;
      descriptorList = snapshot.descriptors;
    },
  };
}

export async function nativeProgramCatalogOptions(context: {
  readonly cwd: string;
  readonly agentDir: string;
  isProjectTrusted(): boolean;
}): Promise<
  Pick<
    ProgramCatalogOptions,
    | "settingsProject"
    | "settingsGlobal"
    | "package"
    | "globalPackage"
    | "installedPackages"
    | "diagnostics"
  >
> {
  const diagnostics: ProgramDiagnostic[] = [];
  const settings = SettingsManager.create(context.cwd, context.agentDir, {
    projectTrusted: context.isProjectTrusted(),
  });
  for (const failure of settings.drainErrors()) {
    diagnostics.push({
      code: "CONFIG_INVALID",
      source: failure.scope,
      message: failure.error.message,
    });
  }
  const read = (scope: "global" | "project") => {
    const path =
      settings
        .getSelectedSettingsSources()
        .find((source) => source.scope === scope)?.path ?? `${scope} settings`;
    try {
      const value = (
        scope === "global"
          ? settings.getGlobalSettings()
          : (settings.getProjectSettings() as object)
      ) as Record<string, unknown>;
      const workflowGraph = value.workflowGraph;
      if (workflowGraph === undefined) return undefined;
      if (
        workflowGraph === null ||
        typeof workflowGraph !== "object" ||
        Array.isArray(workflowGraph)
      )
        throw new Error("workflowGraph must be an object");
      const programs = (workflowGraph as Record<string, unknown>).programs;
      if (programs === undefined) return undefined;
      if (
        programs === null ||
        typeof programs !== "object" ||
        Array.isArray(programs)
      )
        throw new Error("workflowGraph.programs must be an object");
      const result: Record<string, ProgramPaths> = {};
      for (const name of ["project", "global", "package"] as const) {
        const paths = (programs as Record<string, unknown>)[name];
        if (paths === undefined) continue;
        if (
          Array.isArray(paths) &&
          paths.every((entry) => typeof entry === "string")
        )
          result[name] = paths;
        else if (
          paths !== null &&
          typeof paths === "object" &&
          Object.values(paths).every((entry) => typeof entry === "string")
        )
          result[name] = paths as Record<string, string>;
        else
          throw new Error(
            `workflowGraph.programs.${name} must be string paths or named string paths`,
          );
      }
      return result;
    } catch (error) {
      diagnostics.push({
        code: "CONFIG_INVALID",
        source: path,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };
  const global = read("global");
  const project = context.isProjectTrusted() ? read("project") : undefined;
  const installedPackages: {
    root: string;
    paths: ProgramPaths;
    scope: "project" | "user";
  }[] = [];
  const manager = new DefaultPackageManager({
    cwd: context.cwd,
    agentDir: context.agentDir,
    settingsManager: settings,
  });
  const configured = manager
    .listConfiguredPackages()
    .filter((pkg) => pkg.scope !== "project" || context.isProjectTrusted());
  configured.sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1,
  );
  for (const pkg of configured) {
    if (!pkg.installedPath) continue;
    const manifestPath = join(pkg.installedPath, "package.json");
    try {
      const manifest: unknown = JSON.parse(
        await readFile(manifestPath, "utf8"),
      );
      if (
        manifest === null ||
        typeof manifest !== "object" ||
        !("pi" in manifest) ||
        manifest.pi === null ||
        typeof manifest.pi !== "object" ||
        !("workflows" in manifest.pi)
      )
        continue;
      const paths = manifest.pi.workflows;
      const schema = Type.Union([
        Type.Array(Type.String()),
        Type.Record(Type.String(), Type.String()),
      ]);
      if (!Value.Check(schema, paths))
        throw Error("pi.workflows must be string paths or named string paths");
      installedPackages.push({
        root: pkg.installedPath,
        paths,
        scope: pkg.scope,
      });
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        continue;
      diagnostics.push({
        code: "CONFIG_INVALID",
        source: manifestPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    installedPackages,
    settingsProject: project?.project,
    settingsGlobal: global?.global,
    package: project?.package,
    globalPackage: global?.package,
    diagnostics,
  };
}

export async function loadAuthoredProgram(
  path: string,
  context: TrustedContext,
): Promise<StagedProgram> {
  if (!context.isProjectTrusted())
    throw new Error(
      "Project must be trusted before loading authored workflow code.",
    );
  const file = await realpath(resolve(context.cwd, path));
  if (!isInside(await realpath(context.cwd), file) || !isModule(file))
    throw new Error(
      "Authored workflow must be a JavaScript or TypeScript module inside trusted project.",
    );
  const module: unknown = await import(pathToFileURL(file).href);
  if (module === null || typeof module !== "object" || !("program" in module))
    throw new Error("Authored module must export program.");
  const program = module.program;
  if (
    !Value.Check(ProgramMetadata, program) ||
    !("decide" in program) ||
    typeof program.decide !== "function"
  )
    throw new Error("Invalid authored workflow export.");
  const decide = program.decide.bind(program);
  return {
    key: program.key,
    version: program.version,
    input: program.input,
    ...(program.compositionIdentity === undefined
      ? {}
      : { compositionIdentity: structuredClone(program.compositionIdentity) }),
    ...(program.transferArtifacts === undefined
      ? {}
      : { transferArtifacts: structuredClone(program.transferArtifacts) }),
    decide: (value) => decide(value),
  };
}
