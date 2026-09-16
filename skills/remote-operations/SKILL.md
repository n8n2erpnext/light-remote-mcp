---
name: remote-operations
description: Perform governed remote filesystem, search, process, command, and PTY work on one explicit Light Remote device.
---

Use this skill for normal work on an already enrolled Light Remote device.

1. Inspect or list devices and choose the exact target requested by the user.
2. Open or reuse one durable session bound to that device.
3. Prefer structured filesystem and search tools over shell commands when they cover the task.
4. Use managed processes for long-running stdin/stdout work that does not need a real terminal.
5. Use PTY/ConPTY only when interactive terminal semantics are required, including persistent shells, resize, Ctrl-C, or terminal applications.
6. If an operation returns a running job, poll the job and read output instead of repeating the action.
7. Preserve the exact device and session through retries or recovery. Never silently fall back to another device.
8. Respect local policy denials and do not attempt privilege bypasses.
