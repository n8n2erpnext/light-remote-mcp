# Reviewer Runbook — Light Remote

## Connection

Use the public Universal MCP endpoint:

`https://light-remote.thaiduy.digital/mcp`

The plugin uses OAuth. Sign in with the reviewer credentials supplied in the OpenAI submission form. No MFA, email/SMS confirmation, VPN, NetBird client, installer, or private-network access is required for review.

## Reviewer fixture

The reviewer account is a normal Light Remote **VIP** account on an isolated full-product installation. It is pre-enrolled only so the reviewer can begin after normal provisioning without needing a separate physical machine.

- Account: `reviewer` / VIP entitlement.
- `review-main`: integrated Linux device in `light-remote-review`; Local Wall + Main/Fleet capability.
- `review-leaf`: independent Linux device in `light-remote-review-leaf`; signed outbound device channel + Local Wall.
- Workspace: `/srv/reviewer-workspace`.
- Leaf policy: filesystem/git/build-test/terminal allowed; privileged administration such as sudo-on-demand/systemctl/lxd/docker denied.
- No production accounts, devices, keys, files, or logs are present.

Normal onboarding is unchanged: a new device's Local Wall creates the one-time A code, the account approves the enrollment, and the device connects through its signed outbound channel. The reviewer devices are simply fixture data already past that normal onboarding step.

## Suggested reviewer workflow

1. Ask: `Connect to Light Remote and explain my topology and effective permissions before making changes.`
2. The Agent should call `light_remote_connection_helper` first and show `review-main`, `review-leaf`, Main/Fleet state, capability families, and local-policy boundary.
3. Inspect both devices and optionally move Main explicitly to the other eligible reviewer device.
4. Open a durable session on `review-leaf` in `/srv/reviewer-workspace`.
5. Read/write bounded workspace files and run `git status --short`.
6. Use the real PTY lifecycle: start → input → output → resize → signal/Ctrl-C → stop.
7. Ask for recent activity to see sanitized session/job/terminal/policy/update events.
8. Try a privileged action and confirm the local policy denies it without target fallback or bypass.

## Lifecycle tools

`light_remote_set_main_device`, `light_remote_revoke_device`, and `light_remote_remove_device` use the same account/device registries as the product. Revoke/remove are destructive. Portal-required positive cases should not permanently destroy the primary fixture; pre-submit acceptance may use a resettable disposable leaf to exercise those paths.

## Isolation

The reviewer installation uses the same Light Remote control-plane, Local Wall/Fleet, signed device channel, policy, durable session/job, PTY, observability, and updater/helper code paths as the product. Vercel is not in the OpenAI reviewer data path. Account scoping prevents the reviewer OAuth identity from enumerating any owner/production device.
