# Light Remote MCP architecture

The official project is `n8n2erpnext/light-remote-mcp`. This workspace has a new Git object store and no old parents or alternates. The new GitHub repository (ID1450214328) is the development/build source; old ARM source remains preserved reference truth.

```mermaid
flowchart LR
  D[Desktop V4 web UI] --> N[Tauri native Owner vault / Windows IPC]
  N --> P[Plugin HTTPS / Owner PKCE]
  P --> O[Operator private Unix socket]
  O --> G[(PostgreSQL durable authority)]
  P --> R[(Redis coordination / revocable families)]
  O --> R
  O --> A[Signed enrolled Agent channel]
  W[Local Wall / native tray] --> A
  A --> M[RM V2 / PTY / filesystem / Long Memory]
```

Owner login grants `desktop:read`, never Agent execution rights. Device ownership, A/B consent, policy and device signatures remain separate checks. Operator/Plugin each hold an instance-scoped single-writer lock. PostgreSQL owns durable business state; Redis owns short-lived coordination and renewable retained sessions.

`config/endpoints.json` is the package-embedded endpoint catalog. `contracts/api.v1.json` describes reviewed Desktop integration boundaries; `lib/api-contract.mjs` supplies actual public/private route registrations and the API version header. Private Unix routes never become browser URLs. Other legacy route families remain in their existing modules; the catalog does not yet constitute an exhaustive OpenAPI schema.

Core migrations are checksum-locked through 043. Owner authority 045 is an explicitly pinned extension after core 043, with its own extension ledger. Guest 044 remains deferred because the native Guest runtime is unfinished. It is never marked ready by a ledger-only workaround.

Windows candidate0.10.1-dev.2 has one primary `LightRemote.exe`: Tauri/Rust owns GUI/tray and early headless role dispatch, and a fixed-path hostfxr adapter hosts the existing managed Windows implementation as a class library in-process. Private .NET8 frameworks remain DLLs under windows-host. Node, RM V2 and independent update/recovery helpers remain separate. Both old primary EXEs are absent from the final package; existing identities and authority boundaries are retained.

Project Continuity, Chrome Long Memory extension and RC50 portability source were recovered separately. Their availability in the tree is distinct from wiring into the active profile; see the feature matrix.

The [T12 handoff](docs/plans/windows-single-primary-exe/LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md) records design alternatives. The implemented in-process option is described below and verified by the current [primary manifest](docs/evidence/windows-one-primary/PRIMARY_EXE_MANIFEST.json); it does not embed Node or merge independent recovery processes.

## Historical Windows host consolidation prototype

The work branch is testing the T12 in-process .NET-hosting option: one Tauri/Rust native executable calls a managed class library through bounded hostfxr exports. The audited Windows WMI, Job Object, supervisor, native Agent environment and Desktop action implementation remain in that library; no second managed apphost is extracted or executed. Private framework DLLs/runtime remain supporting files under windows-host. Native Owner vault/A-B/SSO authority is unchanged. The regular installer has not switched layout in this prototype step; native proof and compatibility gates precede that change.

## Package one primary LightRemote.exe and prove native migration lifecycle

Windows candidate0.10.1-dev.2 consolidates the previous GUI/hidden host primary binaries into `LightRemote.exe`. Tauri/Rust remains the window/tray and native Owner/keyring authority; a fixed-path hostfxr adapter calls a framework-dependent managed library in-process. The audited managed WMI, Job Object envelope, Agent supervisor/recovery and sanitized twelve-action bridge are reused. No managed apphost is published or extracted. Private .NET framework DLLs remain supporting runtime files. Node/RM/recovery-helper isolation is preserved.

Early OS-only CLI dispatch runs before GUI singleton or Owner/WebView initialization. Multiple independent roles may run from the same native file; closing GUI does not stop the Agent task. The GUI bridge is an allowlist, with no renderer-selected assembly, method, executable path or credential. Agent-only stop matches installed executable/argv/SID/creation time. Full updates use their separate runtime quiesce/health/ack/helper-promotion and verified rollback transaction. Layout JSON may choose only fixed compiled product/profile/file names; it is not an arbitrary executable registry. Native and actual migration CI, existing known issues and physical acceptance retain separate statuses.

## Implement verified native device API and fix Memory startup and Desktop ACL gaps

Added native transport desktopDevice in contracts/api.v1.json: desktop_owner_device_request -> fixed same-user Agent pipe/Unix socket -> desktop-device-api.mjs. Native Owner bearer stays in Rust/Agent; Agent independently verifies current issuer/account and exact enrolled device before dispatch and before projection. Only device.read may discover the current device without a prior deviceId; all mutations require the displayed deviceId. Explicit action allowlist reuses modules.configure CAS, real Memory scope lifecycle/account sync/device-signed tombstones, Codex task CAS/delegation, signed session-close/job-cancel, and private activity-log controls. Default OFF unless the existing exact Gold A/B native package flag/gates are satisfied; no HTTP bypass, wildcard IPC, arbitrary path/shell or Owner-login-to-Agent-grant conversion. Device read uses cheap local state; optional remote Memory roster/policy has one shared in-flight request and bounded wait. Long Codex observation is acknowledged as requested and polled for actual completion, never inferred success.

## Connect Desktop controls to the verified Agent API and unify displayed names

Desktop native-device.ts/useNativeDevice is a scoped read/write provider: current Owner + native expectedAccountId + enrolled device, single-flight visible polling, account/generation invalidation, pre/post-write real reads and no automatic mutation retries. Rust owner_device uses fixed private IPC and native-only bearer. Existing Agent module/controllers execute operations. Settings host start/restart/update remains an exact compiled native action for Agent-offline recovery; it carries no browser credential. Device-change events refresh Owner read models only for the matching account.

## Defer Windows close hide beyond callback and preserve installed responsiveness checks

Windows hide-to-tray must not synchronously change visibility inside CloseRequested. The callback immediately prevents destruction and queues hide from the existing Tauri worker runtime, allowing native listeners to finish before focus/visibility messages. Background Agent/session ownership is unchanged. Source diagnosis follows pinned tauri-runtime-wry2.12.3: https://raw.githubusercontent.com/tauri-apps/tauri/tauri-runtime-wry-v2.12.3/crates/tauri-runtime-wry/src/lib.rs (on_close_requested listener mutex, same-thread send_user_message and WindowMessage::Hide). This is a source-based reentrancy diagnosis; installed CI must confirm the behavior.

## Restore singleton window through owning Tauri runtime to synchronize visibility

Singleton restore uses fixed Local\LightRemoteDesktopV4UnifiedOwner.Show auto-reset Windows event under the existing OS-user/session object boundary. Primary publishes before initialization, then one waiting thread handles show. Secondary signals foreground launch only; the existing GUI restores via owning Tauri worker show/unminimize/focus. There is no command/path/identity/credential payload or new browser/native-action API. Raw ShowWindow remains only for older binaries without the event. CI59 showed responsive second-Close failure after raw restore. Pinned Tao0.37.2 set_visible stores VISIBLE and apply_diff skips unchanged flags: https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.37.2/src/platform_impl/windows/window.rs and https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.37.2/src/platform_impl/windows/window_state.rs . Earlier reentrancy-only diagnosis was insufficient. Installed CI must confirm this restore/cache repair.
