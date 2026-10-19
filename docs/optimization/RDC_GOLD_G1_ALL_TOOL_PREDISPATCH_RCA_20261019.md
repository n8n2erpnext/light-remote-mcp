# Light Remote Gold G1 — All-tool pre-dispatch and MCP failure semantics RCA
Date: 2026-10-19 | Branch: `feature/light-remote-gold-rebuild-20261018`
Starting commit `9ce01cdc86e62e668ff8d00e4367f989e2d5c31a`.
**Status: SOURCE AUDIT + LIMITED AUTHORIZED READ-ONLY LIVE SAMPLES, NOT A ROOT-CAUSE PROOF FOR OPENAI'S PRIVATE GATE. G1 STILL OPEN.**

## Owner's clarified objective
Failures occur intermittently across **many** Light Remote tool families (filesystem/search, exec/process/terminal, infrastructure, SCP, desktop and administration), not just `edit_file` and `exec`. Compare operational reliability and client-facing MCP contracts with Desktop Commander MCP (RDC); identify erroneous Light Remote schema/metadata/result semantics and sources of ambiguity. **Do not disguise a command, mislabel destructive operations, soften A/B/OAuth/final-deny, or use alternate tool/PTY to bypass a pre-dispatch refusal.** All remediation only on the existing Gold branch; production untouched.

## Evidence sources
- Connected GitHub: `wonderwhy-er/DesktopCommanderMCP` pinned `f508e524469c26f6366e17dbfd3ee5a69d112127`, notably `src/server.ts` server instructions/schema/annotations, `src/tools/improved-process-tools.ts`, `src/terminal-manager.ts`.
- Gold source: `plugin-server/tools.mjs`, `plugin-server/tool-helper.mjs`, `plugin-server/tool-error-classification.mjs`, `plugin-server/oauth.mjs`, `plugin-server/operator-adapter.mjs`, `operator-host/executor.mjs`.
- Earlier evidence: `docs/releases/LIGHT_REMOTE_TOOL_SAFETY_MULTILAYER_AUDIT_20261019.md`; `RDC_GOLD_G1_ENVELOPE_AND_NEWLINE_GREEN_CHECKPOINT_20261019.md`.
- Current actual connector tool signatures inspected using locally available connector metadata; no hidden OpenAI policy implementation or classifier trace was accessible.

## Source/metadata comparison — facts and limits
- Gold `registerPluginTools()` registers **80** distinct MCP tools, including dynamically produced desktop actions, not merely the 66 static `add(...)` expressions in `tools.mjs`.
- All 80 names/annotation boolean types/OAuth scopes were covered by the previous `selftest-gold-plugin-tool-contract.mjs` PASS. It proves structural consistency, **not** that a classifier finds all descriptions safe or that every real tool succeeds.
- Heuristic family inventory from the real registry: 30 desktop, 9 SCP, 13 filesystem/search, 3 process, 3 terminal, 11 account/session, 11 others. These are audit buckets only.
- Many Light Remote tool descriptions are concise: `read_file` 47 characters, `write_file` 42, `output` 42. RDC descriptions are longer, include scope, recommended workflow, read-later behavior and server-wide instructions. RDC's `src/server.ts` explicitly sets `instructions: SERVER_INSTRUCTIONS`; no corresponding `instructions:` entry was found by a text search in the inspected Gold `plugin-server`/`gateway` modules. **Hypothesis**, not proof: precise, non-evasive tool workflow guidance may reduce ambiguous argument selection and mistaken model retries.
- Light Remote `exec` is appropriately marked destructive/open-world because the same tool can run a read or change a remote system. RDC also labels genuinely mutating tools destructive; its lower observed refusal rate cannot be attributed to honest annotations alone.
- Light Remote tool `edit_file` accepts `oldText/newText` up to 4 MiB each. A specific patch may include code or security-sensitive infrastructure words in these arguments. Large expressive inputs can alter client/tool invocation context, but there is **no direct evidence** of how OpenAI's private pre-dispatch gate uses them. Do not shrink limits or mask contents to try to influence the gate without usability evidence.

## First live read-only admission sample (owner-authorized official Light Remote)
Eight deliberately harmless tool-family probes:
1. Existing-session lookup.
2. Owned-device inspection.
3. Allowed Gold workspace directory list.
4. Allowed source-file stat.
5. Bounded source-file read.
6. Existing managed process list.
7. Existing terminal list.
8. Sanitized recent activity.

**8/8 tool calls were accepted**. The five operations returning jobs reported `ok:true`, in approximately 0.6–1.0 seconds for those particular calls. This is a tiny nonrandom read-only sample; it cannot estimate OpenAI refusal prevalence or compare cross-provider reliability.

## Reproduced independent product bug: failed operation does not carry MCP isError
Official `light_remote_stat_path` on a **nonexistent allowed workspace path** returned:
```json
{"ok":false,"data":{"ok":false,"error":"filesystem_path_not_found","status":404},
 "job":{"state":"error","exitCode":1}}
```
But the MCP result contained only `content` and `structuredContent` and **no `isError:true`**.
Source: `plugin-server/tools.mjs::result()` always emits those two fields without reflecting `structured.ok===false`. `guarded()` catches thrown exceptions and sets `isError:true` through `pluginToolErrorResult()`, but a normal `operationView({ok:false})` is *returned*, not thrown. This means some actual Agent/Operator failures are not marked MCP errors, so clients may have to parse text/structured content manually and can misclassify or repeat work. This is **a verified Light Remote contract bug**, distinct from an OpenAI *pre-dispatch* refusal.
Proposed minimal fix to review separately: in normal MCP `result()`, mark `isError:true` when and only when the app explicitly returns top-level `ok:false`; preserve content, structured data and success shape. Regression must exercise filesystem/process/transfer failures and success; no authorization or retry change.

## Another pre-dispatch refusal during this very investigation
An attempt to create a **fixture-only test module** for failed MCP responses via `light_remote_write_file` was refused before reaching the connector. The proposed test included a temporary override of an adapter method in the isolated Node process, purely for test isolation. A potential interpretation is that its source text was mistaken for tampering, but **no internal filter reason was exposed**; causality cannot be asserted. The same session had accepted read-only inspections and earlier, ordinary repo changes. No alternate command, shell, PTY or provider was used to write that refused fixture.

## Three independent refusal layers (never collapse these)
| Layer | Job visible? | Example | What can be fixed in Gold? |
|---|---|---|---|
| OpenAI/client **pre-dispatch** | No Light Remote job | Previously `lxc --version`, certain `edit_file`/file-test writes refused; identical legitimate edit later accepted | Light Remote does not control the provider's private gate. Improve truthful schema and collect sanitized evidence; provider review for reproducible false positives. |
| Plugin/Operator/Fleet **application refusal** | Sometimes signed Operator activity but no dispatched device job | `target_node_capability_missing` for unapproved Docker; missing OAuth scopes or legacy schema | Improve honest diagnostics/metadata and fix proven policy-advertisement inconsistencies, without widening privileges. |
| Agent/OS **execution failure** | Usually job exists with exit code/status | `systemctl is-active` exit 3/4, nonexistent file error | Mark accurate MCP `isError`, keep command result/OS exit separate, offer proper next action. |

## Direct RDC comparison constraint
A connected RDC plugin is available to inspect its **published tool metadata**, and GitHub source was read. However all four registered RDC remote devices were **offline** at the time of this investigation (including two VPS-ARM registrations); therefore a true side-by-side live acceptance-rate benchmark against the same authorized host **was not possible**. This is **NOT** evidence RDC is more/less likely to be refused by the provider.

## Next G1 protocol (requires no security bypass)
- Record **all 80 tools** by family, expected effect/read-only/destructive scope, argument type/size and layered status; test mutations only on owner-authorized disposable Gold fixtures, never live production.
- For rejected *pre-dispatch* calls: capture timestamp, connector/tool name, high-level nonsecret argument shape/length, proposed action, user authorization, platform error text, whether any Plugin/Operator job was created; never log A/B, JWT, private keys or raw confidential file content. If possible submit reproducible authorized benign examples through the platform feedback channel.
- Compare same **ordinary harmless task** using natural documented tool selection, only when both RDC and Light Remote connectors have authorized ONLINE devices. Do not reroute a rejected attempt to force an outcome.
- Patch the verified returned-failure `isError` contract separately after a safe, non-invasive regression can be executed; do not assume it will solve pre-dispatch gate refusals.
- Improve tool and server instructions only to accurately clarify effect scope, separation between read, bounded job, and long-running process; no deceptive framing.
- G1 not complete; owner-approved broad reliability audit now supersedes narrow edit/exec-only focus. Remain on `feature/light-remote-gold-rebuild-20261018`; G2–G6 not started; Gold signed transport previously proved working.
