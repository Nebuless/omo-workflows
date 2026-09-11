# Language Servers

## Toolchain

`mise.toml` pins all language-server executables used by this repository:

- `npm:typescript-language-server@6.0.0` and `npm:typescript@7.0.2` serve
  TypeScript and JavaScript.
- `aqua:tamasfe/taplo@0.10.0` serves TOML.
- `aqua:artempyanykh/marksman@2026-02-08` serves Markdown.

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

This machine has that configuration installed. It contains no secrets or
repository-specific paths.

## Verification

```sh
mise x -- typescript-language-server --version
mise x -- taplo --version
mise x -- marksman --version
```

Use OMO's `lsp_diagnostics` tool on a `.ts`, `.toml`, or `.md` file. A response
with no diagnostics proves server startup and a completed diagnostics request.
