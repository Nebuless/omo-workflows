# Language Servers

## Toolchain

`mise.toml` pins all language-server executables used by this repository:

- `npm:typescript-language-server@6.0.0` and `npm:typescript@7.0.2` serve
  TypeScript and JavaScript.
- `aqua:tamasfe/taplo@0.10.0` serves TOML.
- `aqua:artempyanykh/marksman@2026-02-08` serves Markdown.
- `npm:@biomejs/biome@2.5.6` supplies the required parser/quality CLI and Biome
  language-server executable.

Install them after cloning:

```sh
mise install
```

## OMO Configuration

OMO ignores project-local LSP command definitions for safety. Put custom
commands in `~/.pi/lsp-client.json`, where each command runs through `mise x`
and therefore uses the project pins. Merge these entries into an existing file:

```json
{
  "lsp": {
    "typescript-mise": {
      "command": ["mise", "x", "--", "typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
      "priority": 100
    },
    "taplo": {
      "command": ["mise", "x", "--", "taplo", "lsp", "stdio"],
      "extensions": [".toml"]
    },
    "marksman": {
      "command": ["mise", "x", "--", "marksman", "server"],
      "extensions": [".md"]
    }
  }
}
```

This is a setup example, not proof that the servers are active. The mise pin
alone does not register Marksman with OMO. The example contains no secrets or
repository-specific paths.

## Mutation formatting

Native `formatOnMutation` controls are separate from post-edit diagnostics and
repository quality checks. Verify actual output against `biome.json`, not the
formatter label reported by the mutation hook.

The October 1 audit of OMO `5.1.8` observed the resident LSP formatter changing
two-space TypeScript to tabs. The pinned [formatting defaults](https://github.com/code-yeongyu/oh-my-openagent/blob/ac28307c18c247dea911160fd63654e1cdd0da9f/packages/lsp-core/src/lsp/format-document.ts)
requested `tabSize: 4, insertSpaces: false`. The later October 16 report in the
[issue register](issues.md#2026-10-16t215833z---mutation-formatter-overrides-repository-indentation)
records the supported fresh-session opt-out,
`"formatOnMutation": { "mode": "off" }`, and the observed quality recovery.
That is a dated local workaround, not proof of an upstream formatter fix.

## Verification

```sh
mise x -- typescript-language-server --version
mise x -- taplo --version
mise x -- marksman --version
```

Use OMO's `lsp_diagnostics` tool on a `.ts`, `.toml`, or `.md` file. A response
with no diagnostics proves server startup and a completed diagnostics request.
