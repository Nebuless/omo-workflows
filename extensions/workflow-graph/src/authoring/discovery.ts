import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti/static";
import { DefaultPackageManager, SettingsManager } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { StagedProgram } from "../execution/policy.ts";

const ProgramMetadata = Type.Object({
  key: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
  input: Type.Object({}, { additionalProperties: true }),
});
const isModule = (path: string) => /\.[cm]?[jt]s$/.test(path);
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
  let programs = new Map(
    options.bundled("").map((program) => [program.key, program]),
  );
  let sourceList: ProgramSource[] = [...programs.keys()].map((key) => ({
    key,
    kind: "bundled",
  }));
  let diagnosticList: ProgramDiagnostic[] = [];
  const load = async (
    candidate: Candidate,
    kind: ProgramSourceKind,
    root: string | undefined,
    next: Map<string, StagedProgram>,
    nextSources: ProgramSource[],
    nextDiagnostics: ProgramDiagnostic[],
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
    try {
      // Jiti reloads each entry without moving import.meta.url or relative imports.
      loaded = moduleLoader(file);
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
    next.set(program.key, {
      key: program.key,
      version: program.version,
      input: program.input,
      decide,
    });
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
          );
      }
    }
  };
  return {
    list: () => [...programs.keys()],
    get: (key: string, artifactRoot: string) =>
      sourceList.find((source) => source.key === key)?.kind === "bundled"
        ? options.bundled(artifactRoot).find((program) => program.key === key)
        : programs.get(key),
    requiresExplicitResume: (key: string) =>
      sourceList.find((source) => source.key === key)?.kind !== "bundled",
    sources: () => sourceList as readonly ProgramSource[],
    diagnostics: () => diagnosticList as readonly ProgramDiagnostic[],
    async reload(context: Pick<TrustedContext, "isProjectTrusted">) {
      const next = new Map<string, StagedProgram>();
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
        );
        await loadPaths(
          [join(options.cwd, ".omo", "workflows")],
          "project-local",
          options.cwd,
          options.cwd,
          next,
          nextSources,
          nextDiagnostics,
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
      );
      await loadPaths(
        [join(options.agentDir, "workflows")],
        "user-global",
        options.agentDir,
        options.agentDir,
        next,
        nextSources,
        nextDiagnostics,
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
        );
      await loadPaths(
        options.globalPackage,
        "package",
        options.agentDir,
        options.agentDir,
        next,
        nextSources,
        nextDiagnostics,
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
          next.set(program.key, program);
          nextSources.push({ key: program.key, kind: "bundled" });
        }
      }
      programs = next;
      sourceList = nextSources;
      diagnosticList = nextDiagnostics;
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
    decide: (value) => decide(value),
  };
}
