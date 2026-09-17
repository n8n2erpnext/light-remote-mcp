# OpenAI reviewer deployment overlays

These files are reviewer-only deployment invariants for the full-product fixture.
They do not change Light Remote product behavior.

- Every device eligible to become Main must be able to write the Fleet component store.
- Use one canonical release drop-in per systemd service and overwrite it atomically on activation.
- Do not stack competing release `ExecStart` drop-ins (`zz*`, `zzz*`, etc.).
- After activation, verify effective `ExecStart` for operator, plugin, Wall, and leaf against the exact CI-approved commit.
- Keep reviewer account/device state isolated from production accounts, keys, files, and logs.
