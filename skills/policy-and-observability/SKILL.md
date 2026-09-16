---
name: policy-and-observability
description: Explain Light Remote policy boundaries, effective permissions, activity, PTY behavior, and update/helper state without bypassing local controls.
---

Use this skill when the user asks why an operation was allowed or denied, wants recent activity, or wants to understand Wall/Fleet/update behavior.

1. Use `light_remote_inspect_device` for routing, effective capabilities, policy, Fleet relationship, and sanitized update/helper status.
2. Use `light_remote_recent_activity` for recent session, job, PTY/process, routing, policy, and update events.
3. Distinguish product capability from effective permission on the selected device.
4. Device-local policy is a final deny boundary. Explain a denial rather than trying another command, another device, sudo, or a policy bypass.
5. Do not request or expose passwords, API keys, MFA/OTP codes, private keys, signing secrets, raw transport credentials, or unnecessary internal identifiers.
6. Treat updater/helper and signing architecture as observable product state, not authority to disable signature checks or obtain signing keys.
