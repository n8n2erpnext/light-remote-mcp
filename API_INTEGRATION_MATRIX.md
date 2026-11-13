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

## Rebuild Desktop as a user workspace and fix populated approval and monitor layouts

No endpoint/method, schema version, native allowlist, Owner/device binding or OAuth scope change. Browser consent HTML moves into plugin-server/desktop-consent-page.mjs; desktop-auth-v4-server.mjs still owns Owner verification, one-time intent/CSRF, callback validation and exact CSP. User labels do not rename compatibility route/profile/vault identifiers.

## Record verified all-screen Desktop UX installer and same-source internal consent deployment

Current verified947a117/CI45 keeps light-remote.api.v1 and all native/API/OAuth authorities/identifiers unchanged. Both real B paths/native API pass in25-check CI integration. Internal Lab Operator+Plugin/consent now serve0.10.1-dev.4 from the same GitHub source, snapshot unauthenticated401 and public API/version health PASS. Positive browser Wall SSO physical acceptance remains separate.

## Fix Codex state usage Wall history PTY and responsive Desktop lifecycle

Add codex.preferences to the fixed native Owner/device action contract (33 operations); only catalog-advertised model/effort identifiers are persisted, with an Owner/enrollment/module recheck before writing after awaited metadata. codex.read projects sanitized cached account/login/catalog/selection/quota/tokens. New/updated Wall status/preferences/history routes come from config/endpoints.json configRevision3 and contracts/api.v1.json; issuer/profile/resource/vault identity is unchanged. Owner+CSRF remain required for Wall writes. History before cursor is an opaque event hash, independent of file names, with explicit retained-history coverage, max1000 records/1MiB per page and current device/Owner recheck after async read. Quota unsupported/stale differs from0; token notices contain cumulative totals and are deduplicated. Browser consent font-src self is the only added public asset permission; loopback callback serves only a fixed public font with strict Host checks and no OAuth replay.

## Record CI64 verified internal dev5 and Owner self-test handoff

CI64/source8e0d932920d218c54f83989978f3866c321e20de: light-remote.api.v1 preserved; configRevision3 centralizes Codex status/preferences and history. Native33-action allowlist and pre-save Owner/device/module fence pass. Exact backend25, including independent Wall B and Account B, PASS. This is isolated integration acceptance; Lab Operator/Plugin still947a117/dev4 and new consent presentation is NOT_DEPLOYED. Owner physical acceptance/main promotion remain pending.

## Checkpoint fresh Windows distribution redesign and verified dev5 Lab deployment

Dev5 Lab Operator/Plugin now serve CI64/source8e0d932 with light-remote.api.v1 and existing Owner/A/B authority unchanged. Health version/API and unauthenticated native snapshot401 PASS; no schema migration. New tray presentation must derive actual state from the existing sanitized native bridge, not UI guesses.

## Implement fresh Moryqa Windows setup uninstall and five-state primary tray

The private native status response adds visualState from the existing VisualFor projection (stopped/unlinked/disconnected/dormant/connected). This additive presentation field changes no authorization/endpoint/issuer/profile or credential identity. Tauri independently rejects missing/contradictory connected status before rendering green; no cloud state is synthesized by the UI.

## Fix native installer surfaces and typography, tune tray and integrate Google sign-in

Desktop `desktop_owner_begin` accepts only absent/default or fixed Google presentation selection; `login_provider=google` routes anonymous same-origin consent requests through existing `/account/google`, preserving PKCE/state/install nonce and explicit consent. Wall exposes existing browser challenge only after OS-private Agent IPC readiness on exact loopback Gold profile; native Owner ticket redemption and live-family validation remain signed, single-use and enrolled-device bound. Google credentials remain server-side PostgreSQL; callback derives from running profile origin; inflight config rotations fail closed. Account login does not grant A/B access.

## Preserve production Google callback for domain rotation and verify explicit Wall SSO gates

Google config reports credentialsSaved/pendingDomainSwitch separately from configured. Save retains registered callback; begin rejects mismatched current origin rather than silently rebasing callback or authenticating against production. Google unavailable fallback preserves same-origin native intent for password login. Wall SSO adapter requires both native bridge and independent `LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4=1`; server issuer/operator/edge gates remain separately required.

## Record CI84 internal installer acceptance, Lab rollout and preserved Google callback

CI84 Google entry/provider allowlist and native intent/callback binding tests PASS. Lab public auth-capabilities now truthfully reports credentialsSaved=true, configured=false, pendingDomainSwitch=true with the existing production callback. This is preconfiguration for later domain-role rotation, not an authenticated Google round-trip. Wall SSO and Agent A/B grants stay independently gated. Public health/API contract and unauthenticated snapshot401 verified after backend rollout.

## Preserve native RMv2 cursors and honor precise input timing

Existing move durationMs/steps now survive both validators; explicit0 interval/timing retained. Additive nativeTiming/bridgeTiming carry per-process monotonic durations and requestId. Windows batch results preserve text contentVerification=unverified and verifiedInsertedUnits=null. Local interruption errors forbid blind replay; legacy applied is not content verification. A/B/grants/device targeting and api.v1 identity unchanged.

## Keep RMv2 working sessions visible and yield input without failing Agent sessions

Native RMv2 additive input receipt on Owner activity: applied:false/state:paused/reason:owner_input/sessionRetained:true/resumeRequiresObservation:true/automaticReplay:false. Optional requestedUnits/sentUnits measure requested and emitted UTF16 events only; verifiedInsertedUnits:null/contentVerification:unverified. No public permission/schema expansion. Agent must reobserve target and content before continuation, never replay the full mutation automatically.

## Require explicit RM task scopes with confirmed close,45s orphan cleanup and sky-blue awareness

contracts/api.v1.json rmTaskLifecycle v1 records attach prerequisite, optional desktopSessionId on named input/semantic tools, confirmed scopeClosed/taskEnded/newAttachRequired close receipt,45s quiet fallback and owner binding. Tool descriptors/helper/per-operation rmTask receipts require close-before-final-report; this is a client protocol requirement, not an invented ChatGPT turn-end callback. Hub live-read alone is cached/passive and does not renew the device scope; use real device frames/observations during active design.

## Package RM task lifecycle module and retain scoped input receipt compatibility

Native input scope metadata is additive under visual; it does not wrap old applied/native/results or semantic acknowledgment fields under mutation/semantic. Existing desktop.run structure remains unchanged. Public task lifecycle and owner checks stay as documented.

## Acknowledge already-closed RM tasks and protect in-flight resume

desktop_detach may return alreadyClosed:true with scopeClosed/taskEnded/newAttachRequired when a verified closure receipt exists for the same A/B session+Agent. Cache holds only task ID/owner/time/ack flags, no native lease token or screen/text; expires15min/max256. Closed IDs remain unusable for input.

## Record verified CI98 RM lifecycle candidate and current project truth

CI98 proves explicit native RM scope close, old scope input rejection, reopen newID and45s expiry despite status. Public Agent mutation gate binds A/B session+Agent. Confirm close before final report; metadata-only owner-bound prior close receipts support automatic-expiry/lost-response retries for15minutes/max256, never input reuse. MCP cannot intercept arbitrary external model final text.

## Add ordered RM work with fast scoped cancel and explicit pointer profiles

New Windows light_remote_desktop_cancel requires remote:execute plus desktop+desktop-input, current A/B/session+Agent-owned desktopSessionId and private native lease supplied by device Agent. Cancellation retains RM/A-B/Agent and is not desktop_detach. Pointer profile forwards through both normalizers/native mapping; compatibility default unchanged, precision/responsive moves0ms/1step, responsive click5/12ms. Native queue/handler timing additive; no automatic click retry.

## Add target-bound Unicode writes with verified progress and live authority checks

Windows named desktop_write_text/type_text now start target-bound asynchronous logical writes; desktop_text_status/cancel use owned writeId. Inline262144 UTF16 units or exact SHA256 local UTF8 sourcePath up to16MiB/8M units; file input needs remote:read plus filesystem and existing Owner read roots. Status has accepted/sent/lastAcknowledged/verified units with explicit semantics and no raw text/readback. A lost chunk response is indeterminate and must be reconciled, never replayed. Default deadline10min/max1h. MAC short HID/AX typing contract retained; advanced Windows options reject preinput on macOS. Legacy low-level batched type remains macOS-only; named Windows typing uses the new logical route. New public signed proxy /device-channel/desktop-work-authorize and private Operator /v1/device-channel/desktop-work-authorize preserve enrollment nonce/signature and current Agent/A-B/account/device/connection/caps. Existing desktop_cancel also interrupts logical typing. Semantic values reject malformed/oversized input rather than slicing4096.

## Reuse fresh RM capture buffers and add crop-aware frame coordinates

Windows attach/direct frame accept optional region{x,y,width,height} in selected-screen physical coordinates. Scoped region is pinned at attach; changing it requires a new scope, not a silently ignored frame parameter. Capture returns cropped virtual bounds plus full screenBounds, actual dimensions/quality/effective limits, freshPixelsChecked/encodeReused/capture timing/counters and mapping metadata. Optional physical coordinateSpace=frame requires exact latest owner-scoped frameSeq; default maxFrameAgeMs15000, selectable1000..45000. Device Agent maps pixel centers through observed ROI/scale to virtual physical pixels without another DPI factor and rejects stale/unknown sequence, topology mismatch, out-of-image or mixed explicit screen offsets. Existing virtual and screen-local coordinates remain compatible. Native recovery clears old mapping; reobserve before input. No new public media/input port or authority bypass.

## Bind typing target before cooperative large-text preparation

Windows text start may return state=preparing with writeId after initial target preflight; poll existing desktop_text_status. preparation.validatedUnits is only validated prefix progress, acceptedUnits remains0 until the whole logical payload passes grapheme/pacing validation, and sentUnits remains0 throughout preparation. This is not completed insertion. A pacing request whose minimum delay exceeds maxDurationMs fails before input; Agent can choose a suitable deadline/unpaced input. Cancellation/status remain responsive during cooperative preparation. Existing remote:execute/read/file-root/current-A-B boundaries and close-before-final-report obligation are unchanged.

## Separate root-guarded UIA observation from ordered input

Additive semantic snapshot fields concurrentInput/concurrentUiChange imply resyncRecommended and require reobservation before input. Changed live task root during traversal fails semantic_snapshot_changed_reobserve without applying input. Semantic mutation resolution checks the pinned root before applying. Post-mutation acknowledgement root changes return resync metadata/automaticReplay=false rather than asking to repeat an already applied operation. Existing A/B, device authorization, local policy, visual scope and explicit close-before-final-report contract are unchanged.

## Add optional exact-monitor DXGI capture with fresh GDI recovery

Additive native capture fields requestedCaptureBackend/captureBackend/captureFallback/gpuCapture/gpuResize/hardwareEncoding distinguish requested opt-in, actual backend, explicit fallback and unimplemented acceleration. Default gdi is retained; gpuResize/hardwareEncoding/videoStreaming remain false. Existing image/jpeg payload/frameSeq/topology/mapping/omitUnchanged contracts are unchanged. GPU capability compiled does not mean hardware validated. Native status advertises independentUiaObservation/observationQueue2 and configured capture plus per-frame actual reporting. Backend selection is an Owner environment setting, not new Agent authority.

## Wait for native text delivery and fence expired input authority

Existing logical-text tools keep total inline262144UTF16/reference16MiB UTF8/8M UTF16 limits. Internal unpaced chunks and maximum grapheme are128UTF16 units; oversized grapheme fails whole preparation with zero input. lastObservedInsertedUnits is a historical successfully read prefix, not current whole-document verification or a resume offset; final verifiedInsertedUnits/full native readback semantics are unchanged. Private bridge text-chunk requires integer authorityBudgetMs1..1000, decremented across helper startup and converted to a receiver-owned deadline; caller absolute native deadlines are overwritten. Expiry before admission preserves the previous acknowledged count; expiry/focus/provider uncertainty after input requires reconciliation and no replay. No new OAuth scope/capability or permission bypass.

## Keep RM capture cleanup responsive and correct native measurements

Capture capabilities add cleanupPending for a deferred resource cleanup request; active metadata is not a live control authorization. No new authority or public tool. Controlled native benchmark uses the same nativeTiming.handlerMs boundary in prior/current sources, rejecting missing/nonpositive timing instead of coercing it to zero.

## Amortize verified text windows without dropping target checks

Logical-text total inline/reference budgets and required/prefer verification do not change. Native prepared maxChunkUnits becomes256; Agent uses256 only unpaced, paced remains<=128 and max grapheme128. Authority<=1000ms, current focus/Owner identity, cancellation/no replay and full final verification remain required. No larger public transport cap or new capability.

## Fence new text packets while completing read-only verification

Private authorityBudgetMs remains1..1000 and is consumed across helper startup/native queue. It expires permission to SEND a new packet; read-only completion of previously admitted events can return after it expires, with authorityExpiredAtReceipt/phase/textTiming diagnostics. An expired completion receipt does not authorize new input or renew A/B. Public logical progress/final verification remains unchanged; no raw target document or payload is returned in these diagnostics. New windows still require fresh current authorization.

## Verify slow text completion across explicit editor capacities

No public request/transport/authority cap changes. Native read-only completion may take up to5seconds; existing Agent chunk RPC10seconds stays. Returned exact observed progress authorizes no further input, and final required verification remains mandatory. Editor/application text capacity is distinct from tool inline262144/reference8M budgets; product never raises application limits or silently substitutes clipboard/SetValue.

## Align keyboard indicators and explicit text acceptance layouts

Native desktop.status.logicalText reports unpaced chunkUnits256, pacedChunkUnits128, maxGraphemeUnits128, preferredPacketUnits32, deliveryWaitMs5000, inputAuthorityBudgetMaxMs1000, deliveryBackpressure when-readback-available. maxChunkUnits in text.start must agree with native status; real native acceptance asserts both endpoints. Large input capacity does not promise any editor accepts a giant single paragraph. CR/LF equivalence is readback comparison only, not silent normalization of submitted input.
