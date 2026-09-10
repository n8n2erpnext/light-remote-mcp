# Light Remote MCP v0.9.0-beta.1

First public beta of the governed cross-platform remote execution/control-plane architecture.

## What is in this beta
- durable owner-bound sessions/jobs with explicit device targeting and no silent fallback;
- outbound Linux and Windows leaf agents with signed Ed25519 device identity;
- signed owner policy revisions plus device-side capability inference before process spawn;
- Windows native tray client and installer with signed update/rollback handling;
- Linux x64/arm64 client packages with systemd persistence and signed update/rollback handling;
- Linux x64/arm64 self-hosted Server/Hub bundle;
- Vercel bridge deployment bundle;
- Wall device policy and signed-update maintenance actions;
- Apache-2.0 project licensing plus bundled runtime notices.

## Beta topology
The self-hosted beta keeps the durable Server/Hub on Linux. Vercel is a thin public bridge/deployment adapter, not the durable job authority.

`Client <-> Server/Hub <-> integration/App/Plugin <-> AI`

The distribution/account/OAuth plane and a public Light Remote plugin listing are post-beta work. Do not interpret this prerelease as a hosted public execution service.
