# Workflow graph extension

Native staged programs run through OMO's task DAG. Program owns staged decisions and artifact admission. Native OMO owns task scheduling, state, retries, and cancellation.

## Repo to extension

`repo-to-extension` turns one public HTTPS Git repository into a proposal-backed native OMO/Senpi extension.

```text
/workflow-run repo-to-extension {"repository_url":"https://github.com/OWNER/REPOSITORY.git"}
```

Optional `extension_name` must match lowercase `a-z`, `0-9`, and `-`. It controls generated `extensions/<extension_name>` directory.

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
