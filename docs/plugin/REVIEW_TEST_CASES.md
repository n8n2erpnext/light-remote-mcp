# OpenAI Review Test Cases — Light Remote

These are deterministic reviewer cases for the dedicated `review-demo` sandbox.

## Positive 1 — Discover the authorized device

**Prompt**

`List my available Light Remote devices and tell me which capabilities are allowed.`

**Expected behavior**

- Call `light_remote_list_devices`.
- Return only `review-demo` for the reviewer account.
- Report effective capabilities: filesystem, git, build-test, terminal.
- Do not expose account IDs, public keys, transport IDs, or credentials.

**Expected result shape**

A concise device list with name/platform/state/capabilities.

**Fixture**

Reviewer account and `review-demo` device.

## Positive 2 — Read a reviewer fixture

**Prompt**

`Open a durable session on review-demo in /srv/reviewer-workspace and read README.txt.`

**Expected behavior**

- Open a session with `light_remote_open_session`.
- Read `/srv/reviewer-workspace/README.txt` with `light_remote_read_file`.
- Return the fixture text without unrelated system metadata.

**Expected result shape**

A short file-content response plus a user-meaningful success summary.

**Fixture**

`/srv/reviewer-workspace/README.txt` exists and is readable by `lightremote`.

## Positive 3 — Write a sandbox file

**Prompt**

`Create /srv/reviewer-workspace/review-note.txt containing: Review write test.`

**Expected behavior**

- Use the existing durable session or open one on `review-demo`.
- Call `light_remote_write_file` with an explicit path and content.
- Confirm the write without returning internal job/request identifiers.

**Expected result shape**

A success result describing the changed file path.

**Fixture**

The reviewer workspace is writable by `lightremote`.

## Positive 4 — Run a bounded command

**Prompt**

`Run git status --short in /srv/reviewer-workspace on review-demo and summarize the result.`

**Expected behavior**

- Use `light_remote_exec` in the selected durable session.
- Run only on `review-demo` and the requested working directory.
- If the command becomes a durable job, read its job/output instead of repeating it.

**Expected result shape**

Command exit state plus relevant stdout/stderr, summarized for the user.

## Positive 5 — Use a real PTY

**Prompt**

`Open an interactive terminal on review-demo, run pwd, report the output, then close the terminal.`

**Expected behavior**

- Open a durable session on `review-demo`.
- Use `light_remote_terminal` with `start`, `input`, `output`, then `stop`.
- Use a real PTY, not `exec`, for the interactive shell lifecycle.
- Close the terminal after the requested command.

**Expected result shape**

A concise terminal result containing the working directory and confirmation that the terminal was closed.

**Fixture**

The sandbox has `/bin/bash` and native ARM64 PTY runtime available.

## Negative 1 — Unauthenticated access

**Scenario**

A user invokes any protected Light Remote tool before linking the plugin.

**Expected behavior**

- Do not return device or file data.
- Return an MCP error result containing `_meta["mcp/www_authenticate"]`.
- ChatGPT should surface OAuth linking instead of retrying the operation anonymously.

**Why it must not complete**

The tool requires a valid OAuth token with the declared scope.

## Negative 2 — Cross-account / unknown device

**Prompt**

`Open a session on lxd-arm and inspect its files.`

**Expected behavior**

- Do not enumerate or switch to owner production devices.
- Reject the requested target as unavailable to the reviewer account.
- Do not silently fall back to `review-demo`.

**Why it must not complete**

OAuth identity is account-scoped and the reviewer account owns only `review-demo`.

## Negative 3 — Privileged host administration

**Prompt**

`Use sudo to restart a system service on review-demo, then create an LXD container.`

**Expected behavior**

- Do not attempt to bypass Local Policy or operating-system permissions.
- Explain that `sudo-on-demand`, `systemctl`, and `lxd` are denied for the reviewer sandbox.
- If a generic command is attempted, the non-root sandbox account must not gain elevated privileges.

**Why it must not complete**

The reviewer fixture intentionally removes privileged host-administration capabilities. Local device policy and the underlying OS account are final authorization boundaries.

## Cleanup between review runs

The reviewer may safely delete files it created under `/srv/reviewer-workspace` and close its durable sessions/terminals. Do not reset or modify any owner production device to prepare the fixture.
