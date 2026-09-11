# Authoring Modular Extensions

Every durable customization ships as its own installable extension package. Use
[`extensions/better-custom`](../extensions/better-custom/) as repository layout
reference.

A root package can load every extension during repository development. It is not
the install boundary for one feature. Each extension needs its own manifest so a
user can install only that feature.

## Package layout

```text
extensions/
  <name>/
    AGENTS.md
    package.json
    src/
      index.ts
      config.ts
      tools.ts
      flows/
      ui/
    skills/
      <capability>/SKILL.md
    test/
      <feature>.test.ts
    LICENSE                  # only for upstream attribution
```

- `src/index.ts` is the sole Senpi entrypoint. Keep it thin: register tools,
  commands, lifecycle handlers, and discovered resources.
- `src/` owns all runtime modules. Split modules by feature boundary; do not put
  implementation logic in `src/index.ts`.
- `skills/` holds optional packaged guidance for operational capabilities.
- `test/` owns package-specific fixtures and regressions. Cross-extension tests
  may live in `extensions/test/`.
- `AGENTS.md` owns package contracts, source responsibilities, and checks.
- `package.json` is the direct-install boundary.

## Manifest and installation

Each extension manifest declares only its own entrypoint:

```json
{
  "name": "@omo-workflows/<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Local installation uses the extension directory:

```sh
omo install -l ./extensions/<name>
```

Root development loading may include all extension entrypoints, but each
extension must also load from its own directory. Remote GitHub installation and
version-pinned source locators need separate verification before documentation.
Do not invent their syntax.

## Runtime contract

Extensions must work alone and beside other installed extensions.

- Use public Senpi APIs and package-local dependencies only.
- Do not depend on extension load order or mutate another extension's state.
- Keep configuration, persistence, provider calls, UI, and host wiring in
  separate modules.
- Preserve upstream license, attribution, and immutable revision when porting.
- Resolve user configuration through host APIs; never hard-code user home paths.

Example entrypoint:

```ts
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { registerExampleTools } from "./tools.ts";
import { exampleSkillPaths } from "./resources.ts";

export default function exampleExtension(pi: ExtensionAPI): void {
  registerExampleTools(pi);
  pi.on("resources_discover", () => ({ skillPaths: exampleSkillPaths() }));
}
```

## Skills and LLM tools

Bundle skills when feature use needs operational procedures, authority rules, or
version-sensitive CLI guidance. Keep one skill per capability boundary.

- Register package skills through `resources_discover`.
- Keep skills portable; never rely on machine-local skill directories.
- Use TypeBox schemas with `additionalProperties: false` for LLM tools.
- Run executables with argv, never shell text.
- Separate inspection from mutation. Inspection tools need explicit read-only
  allowlists, not broad command-group allowlists.
- Require user approval for destructive, privileged, or external actions.
- Return bounded output and exit status. Do not hide process failure.

## Better-custom lessons

`extensions/better-custom` demonstrates preferred modular separation:

- `src/index.ts` owns Senpi registration.
- `src/config.ts` owns persisted configuration.
- `src/flows/` owns provider CRUD workflows.
- `src/probe/` owns external endpoint/model discovery.
- `src/ui/` owns interactive views.
- `test/` owns focused regression coverage.

The Herdr package confirms additional rules: lifecycle reporting, skills, and
CLI tools may ship together when they form one feature; they must not be placed
inside an unrelated extension. Opaque Herdr IDs, strict inspection allowlists,
and lifecycle-versus-session-resume limits remain feature-specific contracts.

## Verification

Run focused checks before package-wide checks:

```sh
bun test extensions/<name>/test
bun run validate:package
bun run typecheck
bun run build
omo -e ./extensions/<name> --print "List available <name> skills and LLM tools. Reply with names only."
```

For a behavioral tool, exercise one safe call through a live OMO session.
Source compilation does not prove discovery or tool activation.
