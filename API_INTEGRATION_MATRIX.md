# API integration matrix

Contract version: `light-remote.api.v1`. Runtime header: `X-Light-Remote-API-Version`. Canonical package origins/routes: `config/endpoints.json`. Requests, response purposes, authority and exact flags: `contracts/api.v1.json`.

| UI/native feature | Plugin contract | Operator/backend | Authorization / verification |
|---|---|---|---|
| Owner login | ownerAuthorize -> ownerToken | Portal account verification and live session | Secure Portal cookie, explicit consent, one-use PKCE code, native-only exchange |
| Persistent Owner | ownerRefresh / ownerSession | Redis family + live PG Portal session | Native vault binding; rotation/revocation |
| Logout | ownerLogout | Delete live Owner family | All descendant access/refresh credentials revoked |
| Overview | ownerSnapshot | operatorOwnerSnapshot over Unix socket | Independent READ flag; Owner/account-session checked again |
| Devices / inventory | snapshot page devices | Native device registry | Owner-scoped bounded cursor page |
| AI access / active grants | snapshot page grants | Native A/B grants | Read surface never grants Agent execution |
| Usage | snapshot page usage | Native usage registry | Owner-bound page and retention semantics |
| Activity / jobs | snapshot page jobs | PG job ledger | Coverage/retention markers; no invented full history |
| Sessions | snapshot page sessions | Redis retained session registry | Bounded renewable history, not immutable audit |
| Open Wall SSO | ownerWallTicket | Trusted internal issuer + signed device relay | Separate flags; actual mTLS edge; enrolled-device proof and live family required |
| Wall pending B approval | wallBApprove | Public A/B V2 signed approval -> Operator | Local Owner consent, device signature and B checks remain mandatory |
| Wall Long Memory | wallModulesRead / wallModulesConfigure | Same-device Agent module manager | Committed revision + pending UI state; source regressions retained |
| Native Windows pending approvals | Tauri -> named pipe | C# Agent host -> device API | Local native IPC plus current A/B gates |
| Fleet/account/settings | Existing account/device routes | Accounts, entitlement, fleet registries | Existing cookie/native authority, no DEV bypass |

The contract catalog covers critical V4 routes. Remaining legacy route families still need full machine-readable request/response schemas before an exhaustive OpenAPI claim is appropriate. No mutable cloud endpoint override or credential migration across products was introduced.

## Begin internal Desktop backend integration from verified source checkpoint

Current source declarations remain distinct from observed runtime. On2026-11-09 the public Lab used Operator t11-f16p02-owner-consent-preview-20261108 and Plugin t08-617-plugin-0f3c2ee1-STAGED, both0.9.0-rc.49. Operator lacks the source Desktop snapshot model, while native Owner auth/token flags differ Operator0/Plugin1. Desktop Long Memory/Codex controls have no native module provider, and renderer-relative status reads do not reach the authenticated local Agent. Next implementation must bind live Owner/account/device-scoped APIs and preserve A/B grant/CSRF/device-signature/consent checks; no fake ready state or unauthenticated fallback.

## Implement verified native device API and fix Memory startup and Desktop ACL gaps

Added native transport desktopDevice in contracts/api.v1.json: desktop_owner_device_request -> fixed same-user Agent pipe/Unix socket -> desktop-device-api.mjs. Native Owner bearer stays in Rust/Agent; Agent independently verifies current issuer/account and exact enrolled device before dispatch and before projection. Only device.read may discover the current device without a prior deviceId; all mutations require the displayed deviceId. Explicit action allowlist reuses modules.configure CAS, real Memory scope lifecycle/account sync/device-signed tombstones, Codex task CAS/delegation, signed session-close/job-cancel, and private activity-log controls. Default OFF unless the existing exact Gold A/B native package flag/gates are satisfied; no HTTP bypass, wildcard IPC, arbitrary path/shell or Owner-login-to-Agent-grant conversion. Device read uses cheap local state; optional remote Memory roster/policy has one shared in-flight request and bounded wait. Long Codex observation is acknowledged as requested and polled for actual completion, never inferred success.

## Connect Desktop controls to the verified Agent API and unify displayed names

desktop_owner_device_request now accepts expectedAccountId as a required renderer generation/binding hint; native current Owner must match before effects. The 32-action allowlist includes explicit confirmed device.connect/device.disconnect via existing signed channel. Memory/Codex expose bounded real local coverage (100 rows, explicit partial notice); account sync is independently verified and unavailable cloud does not hide local scopes. Session close/job cancel apply only to exact local device and retain signed controller policy. Native Codex login opens only a validated HTTPS OpenAI verification URL; JS gets a one-time user code, never tokens.

## Verify both real B approval flows and classify known Wall rejections

Wall /api/abv2/approve maps allowlisted abv2_b_invalid to400, attempt conflicts409, missing404 and rate429; otherwise retains validated4xx status with a generic safe error. Unknown failures remain503/outcome:unknown. No raw Operator/Redis response, key, token or private exception is forwarded. Both Wall and Account still require their independent authenticated Owner/CSRF/current attempt/connection/policy and durable grant gates.

## Preserve explicit Agent start intent and isolate Owner rows during rendering

Windows desktop_native_action adds two fixed compiled verbs service-start/service-stop, documented in contracts/api.v1.json.nativeTransports.windowsHost. A Start on an already running Agent is a successful no-op and cannot stop/restart it. Legacy service remains a compatibility toggle for old callers. No arbitrary executable/path or browser credential crosses this API. Display labels are A/B and Light Remote Desktop; technical v4/abv2 routes/IDs stay unchanged for compatibility.

## Record verified internal Desktop backend candidate and coherent Lab deployment

Current baseline2771f47/CI41: Desktop32-action native device API and14 fixed Windows host verbs are implemented and packaged. Internal Lab Operator+Plugin from that same commit enable current Owner session/snapshot/typed pages. Unauthenticated snapshot401, both signed B flows and wrong-B400 verified. Existing grant/policy/confirmation/CAS gates remain; read-only Owner cloud token is not an MCP grant. Physical Owner Windows acceptance remains NOT_RUN.
