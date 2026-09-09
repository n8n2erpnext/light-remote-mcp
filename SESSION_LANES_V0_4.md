# Session Lanes v0.4

Purpose: let 1–3 ChatGPT agents work concurrently on the same VPS while keeping jobs, output, history and reconnect semantics separated by session ID. This is routing/observability, not a lock manager.

## Lifecycle
1. Agent generates one stable `openId` for the connection attempt, opens a session, and receives a server-issued `sessionId`. Retrying the identical open request returns that same session.
2. Every operator job carries that ID. Jobs from different sessions may run concurrently.
3. Any operator activity refreshes the 30-minute idle lease.
4. If at least one job is running, the session enters `hold`; idle expiry is suspended.
5. If the network/Vercel request disappears during a long build, the job keeps running on the VPS. The agent can resume the same session and query the existing job/output.
6. When the final active job ends, the session returns to `active` and receives a fresh 30-minute grace period.
7. After grace expires, resume returns `410 session_expired`; the agent opens a new session.

## Capacity / resource rules
- Normal target: 1–3 concurrent agents.
- Configured ceiling: 8 live sessions (`OPERATOR_MAX_ACTIVE_SESSIONS`).
- Idle grace: 30 minutes (`OPERATOR_SESSION_IDLE_MS`).
- In-memory session history: 7 days (`OPERATOR_SESSION_HISTORY_MS`).
- Running-job hold is not a permanent lease: current job timeout is capped at 2 hours.
- Expired/closed sessions do not count toward live capacity.
- No heartbeat-only infinite lease is required; real activity renews the lease and active jobs hold it automatically.

## Concurrency semantics
No repo/file/service mutex is added. Sessions are lanes only. If two agents target the same repository, they must coordinate the same way two human operators would: branches, worktrees, clean status checks, commits, rebases/merges, and explicit deployment ownership.

## Tracking
VPS JSONL records session opened/resumed/expired/closed, hold start/release, operator tool calls, exec calls, job/output reads and job lifecycle events. `/api/operator?action=session-stats&hours=168` aggregates the rotating disk logs, so usage history survives executor process restarts. Vercel also emits structured per-request operator logs with action, session ID, status and duration.

## API via Vercel
- `action=session-open&p=<base64url {openId,label,workspace}>`
- `action=session-resume&sid=<sessionId>`
- `action=session&sid=<sessionId>`
- `action=sessions`
- `action=session-stats&hours=168`
- `action=session-close&sid=<sessionId>`

Use the same `sessionId` for all exec/job/output activity in one logical agent lane.
