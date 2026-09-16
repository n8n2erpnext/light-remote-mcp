---
name: fleet-and-device-governance
description: Inspect Main/Fleet topology and safely manage Main, revoke, or remove actions for Light Remote devices.
---

Use this skill when the user asks about Main device, Fleet, multi-device routing, device revocation, or removal.

1. Start with `light_remote_connection_helper` and, when useful, `light_remote_inspect_device`.
2. Treat Main-device selection as an explicit account governance change. Use `light_remote_set_main_device` only for the device the user selected.
3. Never infer or substitute a different device when the requested device is unavailable.
4. Revocation closes a device's remote authority. Removal deletes its enrollment binding and requires fresh local-first enrollment to add it again.
5. Use revoke or remove only after explicit user intent for that named device; do not broaden a single-device request to other devices.
6. After a governance change, re-read topology to confirm the resulting Main/Fleet state.
