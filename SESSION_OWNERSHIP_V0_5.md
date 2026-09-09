# Session Ownership v0.5

Purpose: make audit lanes deterministic when several ChatGPT agents operate the same infrastructure.

## Identity and lane rules
- One agent generates one opaque random `agentId` for its live working identity.
- The server issues the `sessionId`; the agent uses that pair for all work in the lane.
- One `agentId` may own only one live session. Opening again while it is active/HOLD returns the existing session.
- A second `agentId` cannot attach to that session: resume/get/exec/job/output is rejected with `409 session_owner_mismatch`.
- This is an operational ownership boundary for clean routing/audit, not a replacement for Vercel OIDC or the encrypted privileged-call security boundary.

## Lease rules
- Every session-aware tool call refreshes the 30-minute idle grace.
- Read endpoints carry `sid=<sessionId>&aid=<agentId>` after the lane is opened; this records and renews read work too.
- Any active job puts the session in HOLD and disables idle expiry until the last job ends.
- Final job completion releases HOLD and starts a fresh 30-minute grace.
- Job timeout remains capped at 2 hours; therefore automatic HOLD cannot become an infinite lease.
- Default live-session ceiling is 5. Closed/expired sessions leave capacity but remain in audit history.

## Concurrency
Session ownership does not lock repos, files, containers or services. Two separate lanes may target the same repository; they must coordinate exactly like two human operators using Git status, branches/worktrees, commits, rebases/merges and explicit deployment ownership.

## Wall
The wall has `ALL` plus one tab for every active/HOLD session. Each tab filters the combined event stream by `sessionId` and shows node, label, agent, workspace, state, calls, execs, reconnects, active jobs, commands and output.
