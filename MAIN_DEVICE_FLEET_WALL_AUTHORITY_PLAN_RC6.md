# Light Remote — Main Device + Fleet Wall Authority Plan (RC6)

Status: canonical architecture lock for the RC6 engineering slice.
Date: 2026-09-12.

## 1. Goal

Keep the current proven Light Remote architecture and one universal client build while solving plan upgrades and multi-device management without reinstalling the client.

Every installed machine always owns exactly one Local Wall for that machine. Multi-device Fleet Wall is a separate optional component hosted only by the account-selected Main device.

This document supersedes older wording that described VIP Wall as the same Local Wall aggregated across devices. Local Wall never changes identity or scope when plan changes.

## 2. Locked product invariants

- One client source/build for FREE, PRO and VIP. No plan-specific installers or binaries.
- Local Wall is always single-device and remains the primary device setup, policy, log, session and approval surface.
- Closing/reloading Local Wall never owns service, connection, grant, session or job lifetime.
- Device Connection Lease remains finite: Free ~4h, Pro 24h, VIP 72h; no Unlimited.
- Account entitlement unlocks capabilities; client binary does not encode ownership of a paid plan.
- Upgrade or downgrade never requires uninstall/reinstall.
- No silent target fallback. If the selected/default target is unavailable, fail closed or ask for a target.
- A/B device pairing, per-device grant isolation, target-bound sessions and signed device identity remain unchanged.
## 3. Main device semantics

Account Portal is the only normal UI for selecting `mainDeviceId`.

Main means:
- default device focus for Fleet Wall;
- default target when a higher-level client is allowed to use an unqualified device and exactly this policy permits it;
- the only device eligible to host the Fleet Wall component.

Main does not mean:
- changing Local Wall into Fleet Wall;
- merging device identities, policies, leases, grants or sessions;
- silently routing work to another device when Main is offline.

If Main is offline, Fleet hosting is unavailable until Main returns or the account owner selects another Main device. The server never auto-promotes another device.

If Main is revoked, the account must clear `mainDeviceId` and require a new explicit selection. If the same device identity is re-enrolled after revoke, Main may be restored only by an explicit owner action. A normal reconnect of the same enrolled device preserves Main.

## 4. Local Wall vs Fleet Wall

Each device always runs Local Wall on the normal deterministic Local Wall port (current reference: 5491 / `5xxa`).

When an eligible account selects this device as Main, the signed updater may install the optional Fleet Wall module. Fleet Wall runs as a separate service/process on a separate deterministic port (reference: 5492 / `5xab`).

Local Wall remains unchanged in scope and only adds an `Open Fleet Wall` link when the local Fleet service is both installed and authorized/healthy.

Non-Main devices never expose Fleet controls even when logged into the same VIP/eligible account.
## 5. Fleet Authority Lease

Service state and port binding are not security boundaries. A root/admin user may manually start a Fleet binary or bind the Fleet port, so real multi-device authority must be enforced by the Server.

The Server issues a short-lived Fleet Authority Lease only when all conditions are true:
- account entitlement exposes `fleetWall=true` / `multiDeviceConsole=true`;
- `mainDeviceId` equals the requesting device;
- device identity and current account binding are valid;
- the requesting device signs the authority request with its enrolled device key.

The lease is bound to at least `accountId`, `mainDeviceId`, `deviceId`, `devicePublicKeySha256`, entitlement/capability, `leaseId`, `issuedAt`, `expiresAt`, and optional Fleet module version.

Target lease TTL: 5–15 minutes with background renewal. Downgrade, entitlement expiry, Main change, device revoke or authority failure prevents renewal and invalidates server-side Fleet operations immediately.

Every Fleet API operation re-validates Main ownership and entitlement server-side. Sensitive mutations additionally validate live authority rather than trusting only cached UI state.

Copying a lease to another machine is useless because Fleet requests require a matching device signature. Manually restarting a disabled Fleet service may make a port listen, but without valid Fleet Authority it cannot list devices, read cross-device activity, change policy or execute work.

## 6. Entitlement model

Plan names do not directly branch client code. Server entitlement exposes capability flags such as `fleetWall`, `multiDeviceConsole`, connection lease cap, usage metering and other plan features.

Current product mapping assigns Fleet to PRO and VIP; FREE has no Fleet authority. Future tier changes remain server-entitlement changes and do not require client architecture changes. The client consumes entitlement capabilities, not hard-coded plan UI forks.

License keys are redemption instruments only. A key is redeemed on the official Account Portal, becomes Account Entitlement, and is never stored on a device. Paddle/subscription/admin flows may write the same entitlement authority without a key.
## 7. Cross-platform delivery

The universal installer continues to install Agent/Service, Local Wall, Tray helper, signed updater, device identity storage and Local Wall shortcut.

Windows 10/11: per-user background Agent task + tray + independent updater task. Debian-family Linux: systemd user Agent/Wall + AppIndicator tray + privileged signed updater. macOS Big Sur 11+: LaunchAgent Agent/Wall + menu-bar tray + privileged LaunchDaemon updater.

Fleet Wall is an optional signed module delivered by the same updater authority. It is not a second VIP installer. The module may remain cached after downgrade/Main change, but its service must stop listening and its Server authority must be invalid.

Tray `Quit` never stops Agent. Local Wall and Fleet Wall remain browser surfaces; native UI is not reintroduced.

## 8. Account Portal changes

Devices page must expose exactly one explicit `Set as main` / Main indicator for eligible account-owned devices. It must show current Main state and Fleet host health when applicable.

Selecting Main is an authenticated account mutation and must be idempotent. The Server validates device ownership and non-revoked state before accepting it.

Portal upgrade FREE -> eligible entitlement requires no reinstall. Once entitlement and Main selection are valid, Main's updater receives the Fleet module intent, installs/verifies it, starts Fleet service, obtains Fleet Authority Lease, and Local Wall shows the Fleet link.

Downgrade or expiry revokes Fleet authority and stops Fleet service without touching Local Wall, Agent enrollment, device identity or local policy.

## 9. Local Wall account authentication

Primary login is registered Light Remote account email/password verified through a device-signed Server request. Account password/hash is never persisted on the device. The device mints only its own short-lived Local Wall cookie after Server verification.

The existing local `operator` credential remains Recovery-only for fresh/revoked/offline recovery. Account login and Recovery login have independent semantics and must both stay regression-covered.
## 10. Implementation phases

P0 — model/tests: account `mainDeviceId`, entitlement capability flags, Main lifecycle regressions, no-silent-fallback tests, and Local-vs-Fleet scope contract.

P1 — Main authority: Account Registry mutation/read APIs, Portal Set Main UI, revoke/downgrade/Main-change cleanup semantics.

P2 — Fleet Authority Lease: durable/ephemeral authority registry, signed device request/renewal, short TTL, device-key binding, server-side enforcement on every Fleet API.

P3 — Fleet module: split current hosted aggregate dashboard into an optional Fleet Wall runtime package on a deterministic second port. Keep existing Local Wall code untouched in scope.

P4 — updater integration: desired Fleet component state derived from entitlement + Main authority; signed install/update/start/stop/health/rollback on Windows, Debian and macOS.

P5 — UX: Local Wall `Open Fleet Wall` only on authorized Main; Portal Main indicator/selection and Fleet health; clear offline/expired/downgraded states.

P6 — live acceptance: A/B/C devices on one account, choose A Main, prove A Local Wall stays single-device, prove A Fleet Wall aggregates authorized fleet, prove B/C Local Walls remain single-device, then change Main A -> B and verify authority migration without reinstall.

## 11. Security and lifecycle acceptance gates

- Root/admin manually starts Fleet on non-Main: port may listen, Fleet APIs return authority denied.
- Copy Fleet lease A -> B: request fails device signature/binding validation.
- Change Main A -> B: A authority becomes unusable immediately; A Fleet service stops; B receives/renews authority and starts after signed module health gate.
- Entitlement expiry/downgrade: Fleet APIs fail closed and Fleet listener stops; Local Wall and Agent remain usable under resulting plan.
- Main offline: no automatic target substitution and no automatic Main promotion.
- Revoke Main: Main is cleared; all Fleet authority for it is invalidated.
- Local Wall never returns cross-device inventory even for VIP.
- Fleet Wall never bypasses per-device lease/grant/session/policy boundaries.

## 12. RC6 release discipline

RC6 is build-test only until explicit owner approval. No stable tag/release is created by this plan.

Before build: full selftest sweep, root/Gateway audits, diff check, secret scan, Windows/Linux/macOS package contracts, and entitlement/Main/Fleet authority regressions must pass.

Build artifacts: Windows 10/11 package, Linux x64/arm64 + Debian packages, macOS 11+ x64/arm64 package/update artifacts. Tagging or stable publication remains a separate owner decision.

## 13. Architecture freeze — installer, browser setup, tray and updater

Canonical product behavior after RC6 design closure:
- Device Wall is always the single-device management and information surface.
- Fleet Wall is multi-device only, available only to PRO/VIP when this device is Main.
- Canonical local endpoints are `127.0.0.1:5491` for Device Wall and `127.0.0.1:5492` for Fleet Wall. LAN/VPN/NetBird/public URLs are deployment overrides only.
- Server/VPS installation uses an interactive terminal script: preflight, port availability, bind selection, service/autostart confirmation, install, verify, then print URLs/status/next steps.
- Desktop Windows/macOS/Linux use native GUI installers for OS permissions/files/services only. After installation the wizard may ask permission to open the default browser to Device Wall; account linking/onboarding continues in the browser.
- No full native desktop GUI. Tray/menu-bar is a thin shell for Open Wall, Open Fleet when healthy, connection status, Connect/Disconnect, update check, Restart/Stop Agent, About and Quit Tray.
- Quit Tray never stops Agent.
- Fleet `5492` does not need to listen for Free/non-Main devices; it is a reserved optional port/component.

Updater is an independent recovery plane, not an Agent/Wall/Tray feature:
- Updater has its own service/task/daemon lifecycle, config, logs and signing verifier.
- Agent, Device Wall, Fleet Wall or Tray failure must not prevent update checks or recovery installation.
- Tray only requests an update check; it is never the updater authority/runtime.
- Update is signed manifest + artifact hash verification + staging + atomic/safe install + health check + rollback.
- Fleet component update failure must not take down the base client.
- Windows updater must not execute through `GptOperator.Client.exe`; it requires a separate updater runtime outside the replaceable application tree.
- Debian updater remains a privileged system timer/service independent from user Agent/Tray.
- macOS updater remains a privileged LaunchDaemon independent from LaunchAgent/Tray.

## 14. RC6 implementation debt ledger

Status values: DONE, PARTIAL, TODO, BLOCKED.
## 15. RDC replacement acceptance matrix

Goal: Remote Desktop Commander becomes bootstrap/rescue only. Normal daily operation must be possible through Light Remote.

Current acceptance categories:
- Device discovery/targeting: DONE — explicit device/node selection, no silent fallback.
- Durable sessions/jobs/output recovery: DONE — resumable target-bound sessions and durable jobs.
- Shell/PowerShell execution: DONE — generic governed executor with per-device capability enforcement.
- Filesystem/Git/build/test/process/network/log work: DONE through governed executor; dedicated read-only workspace helpers remain convenience only.
- Service/container/package administration: DONE when device policy grants the required capability; local policy remains authoritative.
- Device policy controls: DONE through owner-approved policy mutation.
- Signed client update trigger: DONE for governed Linux leaf path; cross-platform updater recovery remains PARTIAL.
- Multi-device management: PARTIAL — Fleet read plane is live; Fleet mutation/browser controls and Main migration acceptance remain.
- Install/recovery UX: PARTIAL — server terminal contract and desktop browser-onboarding contract are frozen but not fully packaged.
- Cross-platform rescue updater: PARTIAL — Debian/macOS independent; Windows still coupled to desktop executable and must be separated before RDC retirement.

RDC retirement gate: all PARTIAL rows above must reach DONE, then complete one real ARM + AMD + Windows acceptance without using RDC except observation/rescue.