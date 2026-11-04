# OMO Herdr

Install from the repository with `omo install -l ./extensions/herdr`, then start a
new OMO session. This package supplies three integration surfaces:

| Surface | Implemented contract |
|---|---|
| Current desktop | Automatic OSC 7501 lifecycle in an interactive core terminal; `herdr_desktop` observes app layout/status/commands and core terminal state, screen, and templates. |
| Legacy terminal | Automatic `report-agent`/`release-agent`, restart-safe sequence numbers, explicit `omo --session <file>` resume metadata, and discovered typed CLI tools. |
| Orchestration | Five packaged skills cover discovery, one agent, handoff, coordination, and administration. Native OMO retains task graphs and worker execution. |

## Compatibility

- Current desktop: researched `herdr-app 0.1.13`, `hc 0.1.18`; locally verified
  read-only core contract on `hc 0.1.14`. Observation rejects other versions.
  `HC_TERMINAL_ID` plus a TTY selects OSC reporting; print/RPC output never
  receives these terminal control sequences.
- Legacy: typed discovery accepts `herdr 0.9.1`, `0.9.2`, `0.9.5`, retaining the
  `herdr.0.9.1.*` capability IDs and required command inventory. Lifecycle uses
  `HERDR_ENV=1` plus `HERDR_PANE_ID`. `HERDR_BIN_PATH` selects the executable.
  Custom resume metadata requires >=0.9.2; lifecycle remains separate on 0.9.1.
- Persisted sessions advertise `omo --session <file>` through the custom session
  report after claiming lifecycle authority. Unsaved or unsupported paths replace
  any previous resume command with plain `omo`, which starts a fresh session;
  they never restore an unrelated earlier session. Resume execution after a
  full legacy restart has not been exercised locally.
- Desktop app/core is a different platform, not a CLI rename. A `tN` terminal ID
  is not a legacy workspace/pane ID. Core persistence is not OMO session recovery;
  recovery can replace a lost program with a shell.
- No verified native OMO installer/program entry ships in either platform.
  [Legacy PR #5395](https://github.com/herdrdev/herdr/pull/5395) remained unmerged
  when checked. `omp` is a different agent.

`herdr_desktop` is bounded, read-only, and accepts no raw argv. Core reads require
an explicit existing `HC_SOCKET` or `HC_TERMINAL_SOCKET`; missing or stopped endpoints
return unavailable. Unlike `hc` observation commands, they never auto-start a core.
`core-read` reads
only the visible screen, without scrolling. Existing legacy mutations remain
subject to capability availability, fresh target proof, approval where required,
and readback. Start/profile-launch, most topology controls, and Preview remain
unavailable. Current desktop launch/send/layout mutations are not exposed.

## Compatibility evidence

Verified `2026-11-04` UTC. Installed OMO `5.1.58`, engine Senpi `2026.11.2-1`,
repository SDK pin `2026.10.19-2` (installed package metadata reports
`2026.10.16`), mise Bun `1.3.14`. No runtime upgrade is included.

- [OMO current manifest](https://github.com/code-yeongyu/oh-my-openagent/blob/5487861bd8fa24390a1ac6a07896ee6fc9de0043/packages/omo-senpi/package.json)
  and its [Herdr child-hint cleanup](https://github.com/code-yeongyu/oh-my-openagent/blob/5487861bd8fa24390a1ac6a07896ee6fc9de0043/packages/omo-senpi/src/extension/herdr-agent-hint.ts)
  establish native ownership; this extension does not replace task routing.
- [Senpi public extension types](https://github.com/code-yeongyu/senpi/blob/10f0e121ed334050ccec61fd550420d5a3bae144/packages/coding-agent/src/core/extensions/types.ts)
  and installed SDK declarations provide lifecycle hooks, session identity/file,
  tools, and resource discovery. OMO `--help` confirms `--session <file>`.
- [Legacy custom support](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/docs/versions/0.9.5/website/src/content/docs/add-herdr-support.mdx)
  defines lifecycle, session metadata, and explicit resume argv.
- [Legacy terminal state](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/terminal/state.rs)
  retains custom resume argv for the same source/agent, requiring explicit
  replacement even when the new session has no supported persisted path.
- [Desktop guide](https://github.com/herdrdev/herdr-app/blob/93b097f6e29fcb2d90a30dea2f03ce4e5dee7981/src/SKILL.md)
  defines app commands and separates app panes from core terminals.
- [Core status protocol](https://github.com/herdrdev/herdr-core/blob/3965a46caae095a3ead01de237fa13955e52b8c6/crates/herdr-core/src/status.rs)
  defines OSC 7501 states, base64 messages, and `clear`.
- [Core CLI](https://github.com/herdrdev/herdr-core/blob/3965a46caae095a3ead01de237fa13955e52b8c6/crates/herdr-core/src/cli.rs)
  and [API types](https://github.com/herdrdev/herdr-core/blob/3965a46caae095a3ead01de237fa13955e52b8c6/crates/herdr-core/src/api/types.rs)
  define typed observation commands and zero-history screen reads.
- [Core client](https://github.com/herdrdev/herdr-core/blob/3965a46caae095a3ead01de237fa13955e52b8c6/crates/herdr-core/src/client.rs)
  defines newline JSON-RPC and shows why CLI reads can auto-start a service;
  the extension connects directly to the existing endpoint instead.
- [App release manifest](https://releases.herdr.dev/app/latest.json) and
  [core release manifest](https://releases.herdr.dev/core/latest.json) identify
  the researched release pair. Revalidate on any app/core/legacy, OMO, or Senpi
  upgrade, and before enabling another version or mutation mapping.

Regression tests cover wire encoding, sequence/session changes, version gates,
bounded fixed commands, skill discovery, and extension loading. Local CLI help
and real `herdr_desktop` core-list/core-templates calls are verified on 0.1.14.
The desktop binary is absent here; real desktop
rendering and restart/resume remain unverified, not implied by mock tests.
