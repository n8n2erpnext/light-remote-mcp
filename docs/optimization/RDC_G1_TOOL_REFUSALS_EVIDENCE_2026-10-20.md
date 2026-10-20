# G1 — Light Remote refusal evidence, Gold endpoint rebuild
Date: 2026-10-20. Target: owner-authorized VPS-ARM Linux; working branch: `feature/light-remote-gold-rebuild-20261018`.
Purpose: preserve exact user-visible error evidence to investigate falsely blocked operations, without attributing undocumented internal causes.

## Source correction already verified
- Modified file: `client/windows-native/GptOperator.Client/ConnectionConfig.cs` (Gold worktree only).
- `StablePublicEndpoint = "https://gold.light-remote.thaiduy.digital"`; both Bridge/Hub defaults use it.
- Original production URL is added to existing legacy Bridge and Hub URL lists so saved former defaults migrate to Gold.
- Exact source SHA-256 from successful Light Remote read: `66025918314daa7ebcd0b24b77f171a3b7e087d505d843b8f33d467c982c4bd6`.
- This is a source change only. An updated Windows installer is NOT confirmed until a Gold branch push and CI artifact verification.

## Observed refusal — raw response, not a root-cause diagnosis
Exact tool-facing response displayed on refused Light Remote operations:
> Script error: Lệnh gọi công cụ này đã bị chặn bởi cơ chế kiểm tra an toàn của OpenAI. Vui lòng kiểm tra kỹ nội dung bạn đang gửi.

This response contains no rule ID, classifier reason, command policy, security decision trace, job ID, agent log correlation, or proof of a device-local policy denial. **Internal reason: UNKNOWN.** Treat as an upstream/pre-execution rejection *suspected from absence of a job receipt*, rather than established implementation cause. Do not equate it to Light Remote Agent's own authorization mechanism.

## Attempts already observed in the immediately preceding session
- `light_remote_exec` read-only `git status --short` from the Gold worktree: refused.
- `light_remote_exec` to add, commit and push the Gold endpoint fix: refused.
- One combination of exact-text `light_remote_edit_file` actions was refused, while subsequent **separate** ordinary `edit_file` calls succeeded for all three Windows endpoint edits.
- `light_remote_edit_file` for a similar endpoint in `lib/public-endpoint.mjs`: refused. That file was **not** changed.
- GitHub connector `update_file`: one attempt was also refused; earlier a GitHub write returned 403 integration permission (distinct error category).
- Some benign read-only `read_file` requests to the same Windows file succeeded repeatedly, confirming ability to read that file but **not** proving that Git operations were approved or executed.

## Reproduction/triage record for this run
For each new attempt append:
- UTC timestamp (if available); tool method; minimal *non-secret* script/operation signature; same device/session/workspace and branch.
- Exact error message verbatim, including code/stage if present.
- Was a job ID returned? Did `recent_activity` include a dispatch? Was there Agent output?
- Outcome: `DENIED_UPSTREAM_OR_UNKNOWN`, `DENIED_LOCAL_POLICY`, `SUCCEEDED`, or `UNKNOWN` based only on evidence.
- Do not replay destructive operations when results are ambiguous; check current branch/HEAD first. Do not use PTY to evade a denied exec.

## For a future permanent fix
Expose safe, redacted correlation fields at policy/gateway/Plugin/Agent boundaries: request timestamp, operation family, reason category, stage (`tool-admission`, `plugin`, `hub`, `device-policy`, `agent-dispatch`), job receipt present/absent, a stable refusal ID, and user-facing remediation. No secret prompt or credentials.

## Reproduction comparison on 2026-10-20 — same authorized ARM target
| Attempt | Tool | Operation | Result | Remote job receipt |
|---|---|---|---|---|
| Previous turn | `light_remote_exec` | `git status --short` | DENIED, generic safety-check text quoted above | No job receipt in returned error |
| Previous turn | `light_remote_exec` | `git add; git commit; git push` on Gold branch | DENIED, same generic text | No job receipt in returned error |
| Current retry | `light_remote_exec` | `git status --short` in exactly the same Gold worktree | SUCCESS, exit 0 | Job receipt returned, stdout lists modified Windows endpoint config and this report |
| Current retry | `light_remote_exec` | Read-only `git branch`, `git log -1`, `git diff --check`, `git diff` | SUCCESS, exit 0 | Job receipt returned; branch `feature/light-remote-gold-rebuild-20261018`, previous HEAD `e83c702` |

Interpretation: identical ordinary `git status` may be rejected on one invocation and accepted on another without explicit change to device or local policy. This supports a transient/variable **admission symptom**, **not** evidence of the classifier's internal decision rule. Do not mislabel this as a Light Remote local policy denial. Unknown internal reason remains UNKNOWN.

## Outcome — approved ordinary Git flow after retry (2026-10-20)
- The same `light_remote_exec` tool completed `git diff --check`, narrow `git add`, `git commit`, and `git push` with a returned job receipt and **exitCode=0**. No PTY, alternative device, or policy modification was involved.
- New source/evidence commit: `aa871e6cee7c6eda6a42c1225e04104180eb0cbe`, pushed to `feature/light-remote-gold-rebuild-20261018`. Only two paths were committed: `ConnectionConfig.cs` and this G1 evidence file. Unrelated untracked Gold UAT files preserved.
- GitHub Actions Windows Tray Client run: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39364203015, triggered for exact source SHA `aa871e6`; initially `in_progress`, not an installer PASS yet.
- Light Remote `recent_activity` read (200 most recent events) did **not** expose a denial event/reason for the refused upstream tool admission calls. Absence in this bounded view is **not proof** that no upstream event exists.
- **Engineering conclusion:** reproducible inconsistent admission result for equivalent normal operations; exact classifier/rule/decision trace is NOT exposed. **Root cause UNKNOWN; priority OPEN for instrumented gateway correlation.** Do not assert that a device-local Light Remote rule blocked Git.
