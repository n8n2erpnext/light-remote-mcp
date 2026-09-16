# Light Remote MCP — Development & Testing

This document is the technical entry point for contributors, maintainers, and beta testers. The public user guide lives in [`README.md`](../README.md); the English user guide is [`README.en.md`](../README.en.md).

Current Core: `0.9.0-rc.26`.

## Architecture

```text
AI / ChatGPT Web / MCP-capable caller
        |
        v
Vercel bridge (thin HTTPS compatibility edge)
        |
        v
Linux Server / Hub
  - operator gateway
  - session + device authority
  - durable jobs + audit
        |
        +---- trusted Main / host executor
        +---- outbound Windows leaf
        +---- outbound Linux leaf
        +---- outbound macOS leaf
```

The Vercel layer is intentionally thin. Durable device, session, job, policy, and audit state belongs to the Server/Hub. Leaf clients connect outbound and never require a general inbound SSH listener.

## Repository map

- `api/` — Vercel operator endpoints and the ChatGPT Web compatibility flow.
- `gateway/` — public Server gateway, account surfaces, enrollment, and OIDC verification.
- `operator-host/` — durable executor, device/session registries, routing, jobs, Fleet authority.
- `device-agent/` — local Agent, Local Wall, PTY/ConPTY, platform adapters, signed update client.
- `client/` — Windows/Linux/macOS packaging, public update key, update-channel policy.
- `lib/` — shared cryptography, request validation, helper contracts, terminal and update logic.
- `deploy/` — Server packaging, Vercel bundle, CI/selftests, release tooling.
- `channels/beta/` — signed beta update feeds and signed Fleet component feed.
- `assets/` — branding and public screenshots.

## Runtime tool model

The Web compatibility lane returns a `Connection Helper` first. A successful A/B owner approval produces an opaque client capability and a working target context. The caller then loads the `Tool Helper`, which is the canonical runtime contract.

Canonical operations include:

- structured filesystem operations: read, write, edit, stat, list, mkdir, copy, move, delete;
- recursive file/content search with paged results;
- bounded `exec` for one-shot shell work;
- `process-*` for long-running stdin/stdout processes;
- `terminal-*` for a real PTY on Linux/macOS and ConPTY on Windows;
- `scp` for binary/large-file transfer with whole-file and per-chunk SHA-256 checks;
- durable `job`/`output` polling when work outlives one HTTP response;
- explicit session/context lifecycle and exact-device routing.

Prefer structured operations over shell commands. PTY/ConPTY is reserved for software that actually needs terminal semantics such as Ctrl-C, resize, TTY detection, curses applications, interactive installers, or a persistent shell.

## Permission model

Policy is fail-closed and device-scoped:

```text
Main device: supported capabilities ∩ local policy
Fleet leaf:   supported capabilities ∩ server-approved policy ∩ local policy
```

Local policy always retains final deny. `safe`, `developer`, `infra`, `full`, and `custom` are convenience profiles, not privilege escalation mechanisms. `sudo-on-demand` and Windows UAC/admin capabilities remain explicit permissions.
## Trust and update boundaries

- Each enrolled device owns its Ed25519 identity; private device material remains local.
- Owner pairing uses short-lived A/B approval and opaque continuation/client capabilities.
- Update manifests are signed with ECDSA P-256 and artifacts are checked by SHA-256 and byte size.
- The update signing private key must stay outside the repository, Vercel, and CI.
- The independent Updater Helper survives Core replacement and performs health-gated rollback.
- Fleet Wall is a separately signed component. Its version must not be inferred from the Core or branding version.
- Explicit target routing never falls back to another device when the requested node is offline or denied.

## Native terminal contract

`lib/native-terminal.mjs` is the shared terminal registry. Linux uses the packaged PTY backend, macOS uses native PTY support, and Windows uses ConPTY through the native client runtime.

Supported operations are `start`, `input`, `output`, `resize`, `signal`, `list`, and `stop`. Ownership is bound to account, device, session, and agent. Output is held in a bounded in-memory ring and terminal activity is projected to Wall/audit metadata without exposing opaque handles as the primary operator description.

Closing Wall, closing a browser, or closing the shell used for installation must not terminate the supervised Agent, an active cloud lease, durable jobs, or a PTY owned by an active Light Remote session.

## Local validation

Requirements for portable tests:

```bash
node --version   # Node 22.x
npm ci
npm test
```

`npm test` runs `deploy/scripts/run-selftests.mjs --portable`. Host/systemd-specific checks are separate:

```bash
npm run test:host
```

Before a release candidate, run the focused update, Fleet, terminal, account/device, and packaging selftests in addition to the portable suite. GitHub Actions is the clean-runner authority for Windows, macOS, Linux clients, Linux Server bundles, audit selftests, and the Vercel bridge.
## Release discipline

1. Bump `VERSION` and package metadata together.
2. Run portable and targeted local gates.
3. Push a candidate branch and require clean GitHub Actions across all platform lanes.
4. Fast-forward the exact tested commit to `main`; require the main CI matrix to stay green.
5. Create a new immutable RC tag. Never move a failed published tag.
6. Let the Beta Release workflow build release assets from that tag.
7. Sign the exact generated unsigned update manifest outside CI.
8. Verify the signature and remotely re-download every referenced artifact to check SHA-256 and size.
9. Promote `channels/beta/client-update.json` only after the remote verification gate passes.
10. Roll out the Server/Hub through its governed deployment plane and confirm compatibility/Fleet state.

GitHub Releases is the public binary origin for beta packages. CI artifacts are test evidence, not the preferred distribution surface.

## Server and Vercel notes

The self-hosted Linux Server package installs the durable host under `/opt/light-remote-mcp/server`, state under `/var/lib/light-remote-mcp`, configuration under `/etc/light-remote-mcp`, and a localhost-first gateway/Wall. The Server installer prints the **public** operator key set used by Vercel; the matching private operator key stays on the Server.

The packaged Vercel bridge requires:

```text
VPS_MCP_BASE=https://mcp.example.com
VPS_MCP_URL=https://mcp.example.com/mcp
VPS_MCP_AUDIENCE=https://mcp.example.com
OPERATOR_PUBLIC_KEYS_JSON={...public key set...}
```

See [`../deploy/vercel/README.md`](../deploy/vercel/README.md) for the deployment contract and [`../operator-host/README.md`](../operator-host/README.md) for host-specific details.

## Historical engineering material

Pre-beta handoffs, architecture plans, acceptance notes, and one-off migration documentation are intentionally not kept on the clean public `main`. The repository branch `before-beta` preserves the exact pre-cleanup state for maintainers who need historical archaeology.

Legal and third-party distribution notices remain at the repository root.
