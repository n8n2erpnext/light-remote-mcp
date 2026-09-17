# OpenAI reviewer deployment overlays

These files are reviewer-only deployment invariants for the full-product fixture.
They do not change Light Remote product behavior.

- Every device eligible to become Main must be able to write the Fleet component store.
- Use one canonical release drop-in per systemd service and overwrite it atomically on activation.
- Do not stack competing release `ExecStart` drop-ins (`zz*`, `zzz*`, etc.).
- After activation, verify effective `ExecStart` for operator, plugin, Wall, and leaf against the exact CI-approved commit.
- Keep reviewer account/device state isolated from production accounts, keys, files, and logs.

## Reviewer lease availability

`light-remote-review-lease-refresh.timer` checks the independent reviewer leaf once per minute. A live finite lease is never extended or interrupted. If the device is dormant or its hard lease has expired, the local device invokes the normal signed `connect` command for a new VIP 72-hour lease and 60-minute reconnect grace. This is fixture availability automation, not a server-side entitlement bypass.
