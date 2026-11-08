# Light Remote Gold G2 — PTY Wall Viewer and NativeProcess probe
Date: 2026-10-19 | Source start HEAD `a0071b2` | Branch `feature/light-remote-gold-rebuild-20261018`.

**G2 IN PROGRESS, first viewer slice source & Gold-only runtime deployed. This is not production release acceptance.** G1 remaining unexplained pre-dispatch cases carried in [G1 unresolved log](./RDC_G1_UNRESOLVED_REFUSALS_20261019.md); G3–G6 not started. Owner asked not to stall G plan while private filter cause remains unknown.

## Owner screenshot and user-facing problem
Owner screenshot shows VPS-ARM Wall `LIVE OPERATOR STREAM` including `PTY LIST`, `PROCESS LIST`, filesystem jobs, but **not the shell stream or commands typed inside a PTY**. Existing Wall was driven by Operator activity events; `lib/native-terminal.mjs::NativeTerminalRegistry` independently retains a bounded PTY output ByteRing and tracks terminal sessions. Tool operation events cannot substitute for a real PTY transcript.

## Gold-only implementation
- `device-agent/local-wall.mjs`: added **PTY Viewer** button next to activity filter/copy controls, opens a modal with a list of **Device Agent-local PTYs**, shell/state/bytes; user clicks a terminal to reveal its buffered **read-only** output. Output fetched by offset in 32 KiB batches only while modal is open, 1.5-second bounded polling; no raw PTY output in the global activity SSE or initial HTML. Close clears DOM copy of output. Plain text rendering removes common ANSI CSI codes, no HTML execution. No sending terminal input, no pseudo-sudo/PTY command rerouting.
- Authenticated endpoints `GET /api/pty/sessions` and `GET /api/pty/output?terminalId=...&offset=...`. Require valid Local Wall auth **even when Wall otherwise runs on loopback without login**, clamp IDs/cursors and data; `cache-control:no-store`. No endpoint when viewer callbacks unavailable. No public Gold WebUI route added.
- `device-agent/operator-agent.mjs`: wires the **existing** per-process `NATIVE_TERMINALS.list()` and `.output()` into Local Wall in both daemon paths; callbacks return only bounded view fields, never process env or raw terminal input. Other devices/accounts cannot be enumerated through public MCP. Device-local Wall owner authentication is the viewing boundary.
- IMPORTANT LIMIT: **Only Agent-local PTYs** are supported. Operator-host local PTYs are held by a separate registry; they cannot be falsely presented as part of this viewer until an explicitly authorized per-device data path is built. Display this limit clearly in modal/empty state.

## Tests run
1. New fixture `deploy/scripts/selftest-g2-wall-pty-viewer.mjs`: PASS auth required, unauthenticated PTY read denied, default HTML omits output, inline JS syntax valid, one fixture terminal listing, bounded cursor, bad ID/offset rejected, read after explicit request, cache no-store.
2. Existing `selftest-v09-local-wall.mjs` PASS.
3. Existing `selftest-v09-local-wall-auth.mjs` PASS (test's expected invalid-login event is on stderr).
3a. Existing `selftest-v10-native-process.mjs` PASS (start/input/output, stop, owner isolation); `selftest-v10-native-terminal.mjs` PASS (PTY resize/signal, owner isolation, bounded-stop, platform shell selection).
4. Node `--check` for both modified files and `git diff --check` PASS.
5. Genuine Gold MCP: started a transient Bash PTY on owner-approved isolated Gold device, typed a benign `printf` line, verified `terminal_output` buffer contained **both the echoed shell command and printed output**, then requested normal graceful stop. This proves actual PTY data exists, not browser login UI E2E.
6. Only `device-agent/local-wall.mjs` and `device-agent/operator-agent.mjs` deployed to isolated `light-remote-gold-uat` via owner-authorized official Light Remote. Gold Wall restarted; `light-remote-gold-wall` ACTIVE, NetBird `http://100.94.184.141:5591/` returned 303 login, unauthenticated `/api/pty/sessions` returned **401**, Gold Preview /account HTTPS 200, production HTTPS 200.
7. `deploy/scripts/selftest-g2-process-output-drain.mjs` real Node subprocess probe: six 1 MiB synchronous stdout writes each accounted 100% at finished and after close: PASS. Hypothesis about premature `exit` finalization **NOT REPRODUCED**, so **no speculative NativeProcess patch**.

## Remaining G2 and rollout gate
- Owner browser manually logs into **Gold NetBird Wall** and checks modal output, not production Wall `wall.dashboard.thaiduy.store`. No actual authenticated owner UI session or screenshot acceptance was performed by assistant.
- Consider explicit Owner-authorized **Operator-local PTY** viewer only after review of transport/identity and remote owning session; avoid centralizing all terminal transcript data.
- Finish G2 process/PTY spawn-error, signal, cancel, slow I/O, ring-gap, cross-OS lifecycle tests; do not enlarge existing 4 MiB default/16 MiB max buffers without failure evidence.
- Keep production `light-remote-direct`, production Wall and official Plugin untouched until separate release acceptance.
- Reuse existing worktree and SSH Git remote; preserve pre-existing untracked Gold UAT fixtures.
