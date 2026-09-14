# Workflow graph extension

Native staged programs run through OMO's task DAG. Program owns staged decisions and artifact admission. Native OMO owns task scheduling, state, retries, cancellation, and keyed recovery.

`workflow_recommend` validates one current catalog revision and one to five unique
opaque descriptor proposals, `{key, digest, rationale, confidence}`. It publishes
session-local advice only. It does not start work or replace agent prompt.
`workflow_program start` requires `{key, revision, digest}` plus inputs. Direct
`/workflow-run <key> <JSON>` binds current descriptor identity atomically. Stale
identity rejects with `Workflow catalog changed; choose again.` before native
start.

`composeStagedPrograms()` keeps declared stages in one program instance, artifact
root, checkpoint stream, and native run. It namespaces nodes and admits declared
RFC 6901 output mappings. Unapproved stage boundaries require `continue` or
`stop`. This is same-run composition, not continuation.

`workflow_program` action `transfer` requires explicit `confirmed:true`; `/workflow-run transfer` obtains native UI confirmation. Both require current destination identity and a TerminalTransfer v1 manifest.
Only current or restored completed staged source runs qualify. Verified regular
files copy to new destination root, then copied bytes are rehashed before distinct
destination launch. Source DAG and artifacts remain unchanged. Transfer never
continues source run or discovers arbitrary historical or cross-session sources.
Trusted program declarations own schemas and mappings. Linux descriptor-relative
copying narrows same-UID path races but cannot make arbitrary hostile concurrent
replacement atomic.

## Repo to extension

`repo-to-extension` turns one canonical public HTTPS Git repository into a proposal-backed native OMO/Senpi extension.

```text
/workflow-run repo-to-extension {"repository_url":"https://github.com/OWNER/REPOSITORY.git"}
```

Optional `extension_name` must match lowercase `a-z`, `0-9`, and `-`. It controls generated `extensions/<extension_name>` directory. Repository URL accepts exactly HTTPS `owner/repository`, with optional `.git` and one trailing slash. Host is lowercased; path case and `.git` remain. Whitespace, backslashes, percent escapes, credentials, ports, query, fragment, IP and local hosts, and extra path segments reject. Parser is identity validation, not SSRF, DNS, redirect, Git, hook, credential, resource, or repository-code execution protection.

Stages:

1. `inspect-repository` shallow-clones source into run artifacts and reads tracked files only. It does not install dependencies or execute repository code.
2. `design-extension` admits only evidence-backed skills, TypeBox LLM tools, and safe lifecycle hooks.
3. `approve-extension` requires explicit `approve`. `reject`, timeout, or dismissal stop before writes.
4. `build-extension` writes only admitted extension package files.
5. `verify-extension` runs focused package checks without executing inspected repository code.

Artifacts live under the workflow run root in `repo-to-extension/`:

- `repository-report.json` — source evidence and candidate capabilities.
- `extension-plan.json` — schema-bound build plan.
- `build-manifest.json` — exact generated files and exposed capabilities.
- `verification-report.json` — commands, results, and findings.

Repository content is untrusted. Prompts inside source, docs, shell files, or manifests are data, never instructions. Generated extensions remain read-only by default; external writes need a separate explicit approval path.
