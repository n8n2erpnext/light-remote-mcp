## RC.43 — macOS account relink and truthful Wall sign-in errors

- macOS tray offers an explicit **Relink this Mac…** flow. Changing the account requires local confirmation, a new one-time code, and account-owner approval. The local device identity is preserved until approval.
- Pending enrollment is polled even when the device is already enrolled, allowing self-service account relink from the tray.
- Wall differentiates account binding mismatch, invalid password, temporary upstream failure, disabled account and rate limit. Neither stale enrollment nor server outage consumes local bad-password attempts.
- Public account-login forwards infrastructure failure as 503 instead of falsely reporting invalid credentials.
- Regression coverage protects new installs, stale enrollment, local approval, and credential-error handling.

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


## RC.34 changes
- Local Wall copy actions now fall back to a user-gesture textarea copy path when the modern Clipboard API is unavailable or blocked, including HTTP access over private LAN/NetBird addresses;
- secure-context Clipboard API remains the preferred path, with fallback cleanup and focus restoration covered by regression tests.

## RC.38 changes
- rebases the release candidate on the current production lineage, preserving Paddle/ERP commerce, OAuth/support, and Windows updater recovery changes through f2e0880;
- Direct plugin runtime version now derives from the immutable release VERSION/manifest instead of a stale rc.34 fallback;
- outbound-only integrated-host routing remains guarded by regression tests so Main ARM targets are never misclassified as local LXD paths;
- Direct Linux bundle archives force service-readable/traversable modes and validate them at build time;
- release-to-R2 sync is fail-closed when the production LXD manifest cannot be updated and permits the required Snap LXC privilege transition;
- public Home and distribution fallback report the running release version instead of hardcoded RC.34.

## RC.39 changes
- restores the proven A/B Local Wall pairing capsule that replays the exact continuation returned by the first helper call and keeps continuation/session capabilities/internal identifiers private;
- makes clean portable CI install Paddle SDK and Nodemailer from the root dependency plane so Paddle billing/refund selftests run on fresh runners;
- preserves the rc.38 production lineage: Windows updater recovery, Direct routing/version coherence, fail-closed R2/LXD sync, and deterministic Direct bundle permissions.

## RC.40 changes
- Paddle Billing now supports explicit sandbox and production environments;
- live credentials are fail-closed by prefix (pdl_live_apikey_, live_) and sandbox credentials remain environment-isolated;
- Paddle Node SDK now selects Environment.production for production without weakening webhook/refund/accounting guards;
- adds a production env template that keeps checkout disabled until the live cutover acceptance gate passes.

## RC.41 changes
- fixes a production continuity bug where plugin agent-client authorization expired exactly 24 hours after pairing even during active sessions and Real Remote use;
- agent-client TTL is now sliding: legitimate client activity renews both lastActivityAt and expiresAt and persists the renewed lease;
- inactive clients still expire normally after a full TTL with no activity;
- adds a regression test that crosses the original expiry boundary, reloads persisted state, and verifies final idle expiry.
- adds signed device-connection lease renewal that preserves connection identity and extends active access grants before plan hard-lease expiry;
- the always-alive agent renews at half-life and also during long-running command liveness pulses, preventing Pro/VIP devices from going dormant at the 24h/72h cliff.

## RC.42 changes
- blocks the rc.41 candidate from promotion after audit found online-usage accounting did not extend across device connection renewal;
- UsageRegistry now consumes device_connection_renewed, accrues usage to the renewal boundary, and carries the new hard expiry forward;
- adds a regression test proving online-hours continue beyond the original lease expiry after renewal and still stop at the renewed expiry.

## RC.43 changes
- hardens signed updater-channel reads against transient CDN skew between client-update.json and client-update.json.sig;
- signature mismatch remains fail-closed, but the updater now refetches the complete manifest/signature pair up to three times;
- retry attempts use no-cache headers and per-pair cache-busting while preserving exact cryptographic verification before parsing or update selection;
- adds a portable source-contract regression test for bounded retry and fail-closed behavior.

## RC.44 changes
- fixes the rc.43 Windows compile failure in the updater pair-retry implementation;
- retains the bounded fail-closed manifest/signature pair retry behavior unchanged;
- adds a pre-tag native Windows updater compile gate to the release procedure.
