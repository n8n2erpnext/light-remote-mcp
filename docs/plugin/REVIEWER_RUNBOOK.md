# Reviewer Runbook — Light Remote

## Connection

Use the production Universal MCP endpoint:

`https://plugin.thaiduy.digital/mcp`

The plugin uses OAuth. When ChatGPT prompts for linking, sign in with the reviewer credentials supplied in the OpenAI submission form. No MFA, email confirmation, VPN, NetBird client, or additional setup is required.

## What the reviewer account can see

The OAuth reviewer account owns exactly one sandbox device:

- Device: `review-demo`
- OS: Ubuntu Linux ARM64
- Workspace: `/srv/reviewer-workspace`
- Effective capabilities: filesystem, git, build-test, terminal

The account is intentionally isolated from owner production devices and cannot enumerate them.

## Suggested first workflow

1. Ask Light Remote to list available devices.
2. Select `review-demo` explicitly.
3. Open a durable session in `/srv/reviewer-workspace`.
4. Read `README.txt`.
5. Write or edit a file in that workspace.
6. Run a bounded command such as `git status --short`.
7. Start a PTY, run `pwd`, read output, then stop the PTY.
8. Close the durable session when finished.
## Service and isolation notes

The reviewer fixture uses the same production MCP/OAuth code path as normal accounts. It is not a separate mock server. The persisted reviewer credential account ID and the integrated `review-demo` device account ID must both be `reviewer`; deployment acceptance checks this before submission.

Normal Light Remote clients can enroll through `https://plugin.thaiduy.digital/enroll?id=<enrollmentId>` and then use the signed outbound device channel. Those accounts and devices are isolated from the reviewer fixture.

