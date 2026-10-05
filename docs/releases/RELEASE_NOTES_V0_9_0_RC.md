# Light Remote MCP v0.9.0 Release Candidate

Release-candidate build of the governed cross-platform remote execution and control-plane architecture.

## Included in this release candidate
- Device Wall for single-device approval, policy, activity, terminal, and maintenance flows;
- Fleet Wall for governed multi-device routing on entitled plans;
- outbound Windows, macOS, and Linux clients with persistent background agents;
- Windows x64 installer, macOS x64/arm64 packages, and Linux x64/arm64 packages;
- signed device identity, owner-bound sessions, explicit device targeting, and local policy enforcement;
- durable execution, terminal/PTY support, file transfer, Git/filesystem/process helpers, and audit telemetry;
- account/device session authority, OAuth/MCP integration surface, and Vercel bridge packaging;
- independent signed client updater with health gate, rollback, Update, and Force Update paths;
- signed Fleet component delivery with monotonic anti-downgrade protection;
- owner-controlled update promotion: immutable release artifacts, signed channel manifest, SHA/size verification, and fail-closed promotion.

## Distribution model
GitHub prerelease assets remain the immutable build origin for the beta/RC channel. Public download artifacts are mirrored to Cloudflare R2 under the versioned `light-remote/release/<version>/` prefix, while the signed update manifest remains the client trust pointer. The production Direct endpoint serves only the small distribution manifest/install bootstrap and redirects binary downloads to R2.

This is a prerelease candidate. It is not a claim of stable/general-availability status, and it does not bypass the existing approval, policy, signing, or entitlement boundaries.


## RC.31 changes
- native no-console Windows installer watchdog (no visible PowerShell watchdog window);
- oversized device results are budgeted before delivery while preserving command outcome and liveness;
- Cloudflare R2-backed release distribution, removing large binaries from the production VPS;
- one-line Linux terminal/server bootstrap with architecture detection and SHA256 verification.


## RC.32 changes
- Linux Server/Terminal one-line installer now follows a NetBird-style two-phase flow: install first, then `light-remote up` for enrollment;
- fresh headless installs no longer block waiting for account approval during `curl | bash`;
- new `light-remote` Linux server CLI provides up/status/connect/disconnect/drain/undrain/wall commands;
- release-to-R2 polling is installed as a system-level timer suitable for headless/rebooted ARM production hosts.


## RC.33 changes
- Linux Server/Terminal bootstrap now offers Install, Re-install/Update, and Uninstall/Remove modes;
- Local Wall binding is owner-selected: loopback (default), detected RFC1918 LAN, or detected NetBird CGNAT address with NetBird version shown;
- update/reinstall preserves the existing Local Wall binding unless the owner chooses a new one;
- uninstall removes runtime/services/CLI while preserving enrollment identity by default; --purge removes local identity/state;
- Linux CLI status/up/wall now honor the persisted Local Wall bind instead of assuming 127.0.0.1;
- Direct systemd units no longer allow stale environment files to pin an older server version than the current release.
