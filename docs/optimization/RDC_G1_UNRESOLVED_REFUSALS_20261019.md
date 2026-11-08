# G1 — Unresolved refused tool calls (rolling evidence log)
Date: 2026-10-19 | Branch: `feature/light-remote-gold-rebuild-20261018`

Owner decision: keep unexplained tool refusals OPEN, do not block advancement through the master G milestones on their account. Distinguish reliable G1 fixes from unresolved upstream/provider events; do not infer unknown private-filter criteria.

## Known unresolved observations

| Case | Observed call or scope | Stage established | Outcome | Evidence limitations |
|---|---|---|---|---|
| G1-U01 | Official Light Remote `session_control` to resume an already owner-authorized held VPS-ARM session | Tool invocation rejected before Plugin job response | UNRESOLVED; the **ordinary retry in a subsequent user-authorized turn succeeded** | No provider-internal explanation; never claim Linux/SSH/Agent denied it |
| G1-U02 | Prior benign `lxc --version` / filesystem read / source or test edit requests | Some invocations refused before remote dispatch; others accepted normally | UNRESOLVED intermittent | Per-call sanitized metadata varies; no representative refusal-rate measurement |
| G1-U03 | Broad cross-tool reports: FS, exec, process, terminal, infrastructure, SCP, desktop, administration | User-reported intermittent refusals; tool-by-tool stage not verified for every event | UNRESOLVED umbrella inventory | Do not call every failure an OpenAI pre-dispatch refusal; classify each when evidence exists |
| G1-U04 | RDC appears less prone to blocked operations in informal usage | No paired online controlled same-host comparison previously possible | UNVERIFIED HYPOTHESIS | Source metadata differences do not prove private filter preference |
| G1-U05 | 2026-10-19 G2 Gold Wall icon correction: official Light Remote `session_control` for owner-authorized held VPS-ARM session | Tool refused before Plugin/Agent job in one normal attempt | UNRESOLVED; exact same authorized `session_control` call succeeded on immediate normal retry without changing device/tool/policy | Refusal contained provider safety statement but no internal classifier details; do not infer underlying cause |

## Resolved independent product issues (not U01–U04 closure)
- MCP returned `ok:false` formerly omitted `isError:true`: fixed `2e7d327`, Gold live negative fixture PASS.
- Returned Operator/Agent errors lacked typed `layer/nextAction`: fixed `a0071b2`, Gold live five-family negative probes PASS.
- Linux `systemctl` newline handling and signed Gold MCP X25519 envelope readiness: prior Gold source/runtime checkpoints PASS.

## Required evidence if one of U01–U04 recurs
Record high-level nonsecret intent, tool name, input schema/size not payload, timestamp, connector version, stage (pre-dispatch / Plugin / Operator / Fleet / Agent / OS), job ID existence, actual error text after redaction, and whether an authorized normal later request succeeded. No credentials, A/B codes, terminal input/output, signed envelope keys, JWTs or personal file content.

**Never reclassify a pre-dispatch refusal as device authority; never change tool claims, route through PTY or another tool to evade a denial.** Continue remaining G plan and carry these entries until evidence supports a real cause.
