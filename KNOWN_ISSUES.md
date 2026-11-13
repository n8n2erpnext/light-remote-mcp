# Known issues and remaining verification

Current dev5/source8e0d932: full CI64 PASS9/9 and internal installer verified on ARM and locally. Seven source groups have automated acceptance. Owner physical acceptance, newly requested tray/setup redesign and protected-main promotion remain PENDING. Dev5 Lab Operator/Plugin/consent are now deployed with preserved state/processes. [Current evidence](docs/evidence/desktop-followup/ACCEPTANCE.json).

## Historical candidates and prior evidence


Current compiled source947a117/internal candidate0.10.1-dev.4: full CI45 PASS9/9, React121, consent/token36, browser170 and real private backend25 PASS. Internal Lab Operator/Plugin/consent deployed from the same source with unchanged data and independent processes. B overlap, table spacing and technical main-screen presentation now have verified source/renderer fixes across all screens. Owner physical acceptance of this UX remains pending; prior dev.3 was reported functional only.

Local Memory/Codex reads still cap at100 with a visible partial notice. Task/session history is bounded and pageable, not an immutable audit archive. Account reads follow scoped polling; do not infer new grants or optimistic success from local UI state. Earlier dated sections are historical.

| Item | Current evidence | Next action |
|---|---|---|
| Native end-to-end/new backend | source947a117 CI45 native/install/migration PASS; real backend25 PASS; internal Lab Operator/Plugin deployed | Owner reports prior dev.3 functional UI; dev.4 physical acceptance pending |
| Candidate exposure/profile | internal Lab now serves same tested Operator/Plugin commit; disposable candidates remain private | install exact internal artifact; do not publish binaries/feed |
| Wall SSO local integration | Backend mTLS issue positive/negative PASS; local Agent/browser bootstrap production wiring unfinished; UI SSO candidate remains disabled | Finish real native/Agent/Wall wiring with live family and device signature checks |
| New signed B/remote command | real Wall and Account B -> PG/MCP attach PASS; wrong B400 verified | physical new-artifact B and remote command acceptance remain separate |
| Continuity | Source restored; optional modern Wall/core hook absent; P1 gets404; module regression references old Git history | Complete hook/package closure, replace old-history dependency with a pinned fixture; Windows DACL remains unverified |
| Extensions | Existing GoldABV2 LM0.3 retained and integrity/manual-staging source contract PASS; separate legacy LM0.2 restored | Verify real Chrome/current Wall compatibility; do not enable legacy product bindings as GoldABV2 |
| RC50/Guest | Missing portability/prototype source recovered; Guest native wiring incomplete | Keep Guest044 deferred; do not simulate readiness with SQL-only ledger changes |
| Mac/Linux packages | Locked native source builds/tests PASS | Full current installers still NOT_BUILT |
| Windows primary candidate physical acceptance | source947a117/CI45 full installed lifecycle, explicit Start, bridge/reinstall/rollback/watchdog/uninstall PASS | dev.4 Owner physical/account/vault/B pending; incompatible old helpers take pinned bridge first |
| Endpoint/schema catalog | Critical V4 catalog/version/handler wiring exists; legacy schemas and some authorize/SSO/Wall route constants remain | Finish full catalog coverage; do not promise every URL/path can already change from JSON alone |
| Runtime drift/data migration | internal Lab Operator+Plugin aligned to947a117 and Desktop read enabled; DB43+Owner preserved, no SQL migration | independent old Agent/supervisor/transport retained; production UAT/direct untouched |
| Windows current process inventory | WMI process read denied; binary file identity and historical artifact available | Keep runtime provenance UNKNOWN where unsupported; no privilege bypass |

Resolved: stale Owner Cargo.lock made previous native builds resolve dependencies outside the committed graph. Reviewed lock committed; --locked and strict post-build source provenance PASS in final CI. Actual original Wall wrapping/module-state/B fixes were inherited from tested T11 source; reconstruction did not change the Owner's installed app or old server.

DEV helper scope: status displays the last deployment receipt, not a liveness probe. Use labelled Docker inspection for actual running state. Run disposable test before retaining a start candidate; the helper's latest pointer is shared by invocations. This helper remains a DEV tool, not a production service manager.

Repository conversion resolved: new ID1450214328, clean history, new CI9/9, verified GitHub-sourced ARM candidate and protected main. Old ID1361698660 is archived read-only because delete_repo scope was unavailable; old ARM sources/runtime remain untouched.

Signed feed follow-up: preserved client beta manifest is legacy0.9.0-rc.47 with external asset URLs, not the new0.10.0 baseline. Fleet Wall0.9.0-rc.31 points to the old release URL under the reused repository name; the new repository has no historical release at that path. Preserve signed bytes and plan a controlled feed/release migration from legitimate signing material before public upgrades. No feed was promoted during this conversion.

## Begin internal Desktop backend integration from verified source checkpoint

Active task: confirmed deployed Lab backend is mixed0.9.0-rc.49 STAGED source while internal Desktop candidate is0.10.1-dev.2. The local-module UI is still placeholders and Tauri status transport is unbound. Wall B failure is reported and not yet reproduced; do not attribute it to the EXE merge without a real cross-layer test. Work proceeds on the single canonical source; no public release.

## Implement verified native device API and fix Memory startup and Desktop ACL gaps

Fixed in source: first read of Memory usage after enabling could fail with no such table lm_scopes; native inventory pagination command was missing from explicit Tauri ACL. Targeted SQLite/socket/contract tests PASS; native CI and actual Desktop binding are still pending, and Wall B regression remains unresolved until real cross-layer testing.

## Connect Desktop controls to the verified Agent API and unify displayed names

The live Lab backend still runs mixed older rc49 Operator/Plugin/Wall sources. No deployment/physical acceptance is inferred from the new UI. Full signed Wall B roundtrip and final coherent internal backend candidate are pending. Local Memory/Codex listings currently expose100 rows with explicit partial coverage; additional records remain accessible through Wall.

## Verify both real B approval flows and classify known Wall rejections

P2 CI37 failed two source tests that still matched the old displayed A/B V2 label. Source assertions now match A/B and retain all no-legacy-V1 checks. The P2 real backend lacked a disposable OAuth secret because the original read-only suite never called MCP OAuth; initialization and full OAuth/B coverage were added. Wrong B503 was reproduced and classified at Wall. No claim of physical installed Owner Wall acceptance or live Lab cutover.

## Preserve explicit Agent start intent and isolate Owner rows during rendering

Fixed source: an Owner inventory/activity could briefly render previous Owner rows before useEffect cleared state; now filtered synchronously. Fixed source: a Desktop Start could toggle to Stop if another UI started the Agent during confirmation; explicit native desired-state verbs replace the Desktop toggle. Pinned compatibility bridge external download returned504 in CI38 attempt1; attempt2 pending. Physical Owner acceptance remains NOT_RUN.

## Read pinned migration bridge assets through bounded authenticated GitHub API intake

CI38 attempt1/2 failed at an external GitHub release download504 before the migration fixture began; builds/installed GUI restart had passed. This is recorded as overall CI FAIL, never accepted. Bounded asset API intake replaces the failing browser endpoint, and the next full exact-source run must still prove every migration assertion.

## Fix Codex state usage Wall history PTY and responsive Desktop lifecycle

Dev.5 installed-feedback fixes are IMPLEMENTED_LOCAL_VERIFIED, native Actions/installer/Owner physical retest pending. The new history UI pages retained logs and keeps a moving view; disk retention remains finite and intentional, not a200-job ceiling or immutable audit. Previous logs already rotated/cleaned cannot be reconstructed. Full app-server models/usage and actual installed PTY/Close need Owner retest on the exact new installer; unavailable quota is never replaced with guessed0. Existing positive browser Wall SSO and full Mac/Linux installers remain out of this claim.

## Implement fresh Moryqa Windows setup uninstall and five-state primary tray

Dev6 Windows distribution is implemented but native compilation/UI artifact acceptance is pending. Actual Owner DPI/multiple monitor/keyboard/screen-reader behavior and state transition appearance need exact dev6 physical feedback after CI. Existing dev5 compiled evidence cannot certify new V3. Moryqa raw HTML/CSS vector placeholders are archived evidence; native setup uses canonical STOCK image assets.

## Record Owner stop-build instruction and next native acceptance checklist

Final source0397d871 heading102px/bottom-margin change has NOT been native built/tested because Owner requested stopping builds. CI71 prior source302c662 passed9/9 with six actual UI views; that does not certify the later source. Physical DPI150/200, keyboard/screen-reader usage and actual five-state tray transitions remain Owner/device acceptance tasks for the next build. Lab is stilldev5, so final dev6 version synchronization must wait for accepted build/artifact.

## Document RM v2 native cursor preservation, input latency defects and optional GPU roadmap

RMv2 read-only research at764e1d7 confirms remaining normal-system-pointer override on observation/input, restore CLI without live-process disable/state sync, move duration/steps discarded during normalization, explicit0 observe interval changed to250ms, CPU GDI/JPEG capture and serial native RPC. Current code does NOT replace resize cursors or acquire during RobotContext construction. [Plan/source evidence and acceptance checklist](docs/plans/RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md); no new physical reproduction/benchmark or implementation. Dev6 native final-heading acceptance and all Owner-deferred build work remain pending.

## Extend RM v2 plan with target-verified typing and long logical input

RMv2 typing research: Windows SendInput event count/applied does not prove correct control/full text; optional title guard is pre-action only. Long text may exceed input10s despite4096unit cap (native nominal sleep16.384s for4096), while semantic value is silently sliced4096 in multiple layers. See [target verification and long-input proposals](docs/plans/RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md). Focus race cannot be made atomic by a guard alone; exact readback is capability-dependent. Not reproduced/tested/fixed by this docs-only task; preserve current native best-effort.

## Plan local Memory retention, ChatGPT Claude extension and multi-provider API Worker

Research atad3db2f identifies potential durable Memory-body copies through MCP exec script/stdout event logs despite volatile encrypted dedicated sync relay. No actual Owner log/DB inspected. Extension current source lacks Claude/restore and has fixed local/Lab endpoints; hidden/virtualized DOM and double-staging need tests. Desktop cold metadata bootstrap and nonforce30s usage refresh explain UX gaps; screenshots69remaining/31used do not establish inversion. Dedicated MCP reasoning/multiworker/provider adapters remain missing. See [plan and staged tests](docs/plans/LOCAL_MEMORY_EXTENSION_API_WORKER_PLAN.md); research only, no fixes/tests claimed.

## Fix native installer surfaces and typography, tune tray and integrate Google sign-in

Current installer/tray/Google fixes await exact-source native CI and physical acceptance. Wall Google sign-in intentionally uses the existing signed-in Desktop and one-time local challenge, with password/recovery retained when native IPC unavailable. The exact Gold callback must be allowed in Google Cloud; no saved-config status is evidence of real account round-trip. RMv2 research and Memory/API Worker proposals are not implemented by this change.

## Preserve production Google callback for domain rotation and verify explicit Wall SSO gates

Google credentials are intentionally preconfigured for the existing production callback and inactive on temporary Gold domain; Owner domain/bind rotation and real account round-trip are pending. Wall SSO issuer/operator/TLS edge deployment and physical challenge acceptance remain independent pending work; it defaults OFF. This supersedes instructions to register a separate Gold callback.

## Record CI84 internal installer acceptance, Lab rollout and preserved Google callback

Installer white bands/Google Sans descender clipping and overly bright Connected glyph are closed at CI84 native evidence scope (96DPI); Owner physical100/150/200% verification remains pending. Google is intentionally inactive on temporary Gold with original production callback saved; Owner domain/profile/TLS rotation and real Google login test remain pending. Wall SSO source composition is present but its independent activation/edge/physical flow is pending. No public release/feed or Owner vault acceptance inferred.

## Bound hosted DNS recovery and refresh stale installer UI snapshots

CI90 full baseline unaccepted: Windows probe transient native-control rectangle failure and hosted Ubuntu archive DNS. Native RMv2 functional checks PASS again; CI-only recovery retains full validation. No product/runtime regression inferred solely from these two infrastructure/probe failures.

## Bound smooth-motion wait slices for prompt Owner interruption

Phase1 final motion-wait change supersedes CI91. Actual physical local takeover between packets, mixedDPI/custom cursor/fullscreen remain Owner UAT items; do not infer them from selftest/tiny-move CI proof.

## Keep RMv2 working sessions visible and yield input without failing Agent sessions

Physical build92 awareness UI FAIL (intermittent/distant AI badge and missing edge glow); do not label it accepted based on controlBadge flag. Source fix dev8 pending exact native CI and physical test. Pasted typing report:1776units/interval0 sentPASS2.55s but not full readback; paced trial yielded local activity and Chrome foreground; original helper timeout remains distinct and unresolved. Full independent foreground user+AI operation is not available by split-screen; background UIA/window providers or separate desktop require dedicated implementation.

## Record CI94 acceptance and Owner explicit RM session completion contract

Owner build94 FAIL: retained visual/semantic session keeps AI paused/amber border visible after Agent final report. Remedy selected by Owner is explicit RM close required before report plus45s no-running-job/no-RM-activity orphan fallback;45s may require a new RM attach after prolonged silence between tools. Do not infer end of task from chat text/window title. No A/B revoke or Agent/session kill.

## Require explicit RM task scopes with confirmed close,45s orphan cleanup and sky-blue awareness

CI94 physical lifecycle FAIL is addressed in dev9 source pending acceptance. A45s quiet gap between RM calls can expire the task while the model thinks; reopen RM before continuing, A/B is retained. Active native/device operations are protected. External LLM final-message generation cannot be vetoed by this MCP server; close-before-report is carried in tool/workflow/receipts,45s fallback cleans forgotten scopes. Cached Hub push/read alone does not renew device task; sustained design frames/drag/input do. Windows type-text routing, long-input timeout/readback and independent foreground concurrency remain phase2.

## Record verified CI98 RM lifecycle candidate and current project truth

Build94 physical lifecycle FAIL is addressed in dev9 CI98 source with explicit close and45s fallback; physical dev9 retest remains pending. Any >45s gap without running RM work/real observation/input requires reopening. Generic status/heartbeat and passive cached Hub push do not keep RM alive. Long-text content verification/native input timeout improvements and GPU/video phases remain unimplemented; CI latency samples are not before/after evidence.

## Add ordered RM work with fast scoped cancel and explicit pointer profiles

Phase2a queue/profile source needs native CI and measured acceptance. UIA observation/state still shares ordered input lane to avoid provider/root races; further observation optimization remains. Long typing4096/silent semantic slicing/Windows type macOS-only guard and content verification remain unfixed until phase2b. Optional GPU/video and hardware matrix remain pending; Owner physical UAT consolidated later.

## Add target-bound Unicode writes with verified progress and live authority checks

Dev11 long typing is source-complete with portable checks; native compile/provider behavior/large Unicode/focus-switch fixture await exact Actions. UIA providers may be unavailable or stall; no universal content-verification claim. Required verification rejects unsupported/password/read-only semantics before typing where detectable. Win32 keyboard focus remains globally shared; per-packet guards reduce but cannot make a SendInput packet atomic with a concurrent physical focus switch. No auto-resume after interruption/unknown effects. Legacy generic batched physical text still has a4096 technical budget; use the named logical tool for long Windows input. Capture cache/ROI/freshness, measured before-after latency and optional GPU/video remain unfinished. Physical UAT postponed to final combined candidate.

## Correct native logical write variable declaration for CSharp

CI102 Windows failed at native compile CS0819 before the new text fixture. Split RobotContext FinishTextWrite local var declarations; no behavioral/test/threshold changes. Core/backend/Web passed for sourceef54911. New Actions proof pending; no CI102 artifact accepted, no Lab/Owner/production changes.

## Reuse fresh RM capture buffers and add crop-aware frame coordinates

Current-pixel capture/ROI/frame-mapping source and generic UI signal coalescing await native CI. A capture cache hit still incurs GDI copy and full cropped pixel hashing; animated regions will miss. One cached entry intentionally trades multi-view switching hit rate for bounded private memory. Scoped crop is fixed at attach. Input coordinates remain subject to a globally shared Windows foreground/pointer; frame age/topology checks do not prove the UI content has not changed. Largest16MiB content-reference grapheme preparation is still synchronous and initial target binding occurs afterward: make preparation cooperative and bind/check the intended target before that long wait before claiming the long-text plan fully complete. UIA full snapshots remain on the ordered input lane and need root/epoch-safe separation; do not move existing mutable session state blindly across workers. Generic UI hints are coalesced, but semantic journal events keep their existing path. DXGI/D3D11/video and controlled prior-source latency benchmark remain pending.

## Bind typing target before cooperative large-text preparation

OPEN: CI104 Windows real-control16K content/readback did not match; cause not inferred from a sent-event count. Need exact new failure units/hashes/provider/final metadata before choosing a fix. Capture and other platform checks passed but cannot substitute for text acceptance. Huge-reference preparation is now cooperative and native target is captured before it; Owner file-reference I/O still precedes this controller preflight. Strict target guards and initial target validation do not create isolated Windows foreground input. UIA full observation lane/root consistency and optional DXGI/D3D11/video remain pending; no controlled prior-source latency or Owner physical acceptance claim.

## Separate root-guarded UIA observation from ordered input

OPEN: native exact16K content/readback mismatch from CI104; CI105 hung in the fixture without a final diagnostic, so neither cause nor PASS is inferred. New per-stage receipt/step budget is diagnostic, not a product fix. A stuck third-party UIA provider may still monopolize the bounded observation worker, while input/control/capture lanes remain independent; no unsafe provider-thread abort. Physical root/focus/Owner input races and mixed-DPI multimonitor UAT remain pending. Optional DXGI/video and controlled prior-source latency comparison are unfinished.

## Isolate native text acceptance from PowerShell UI runspaces

CI106 exact-source native text FAIL is pinned in docs/evidence/rmv2/text-ci106.json:16384 acknowledged UTF16 sent units,7406 control units, firstDifference0, native readback mismatch. Cannot infer full insertion or normalization-only mismatch. Fixture cleanup hung after failure; isolate with a normal separate STA WinForms process before deciding whether keyboard batching, queue pressure, provider readback or old PowerShell message pump caused the content discrepancy. No raw text is logged. New fixture may reveal product defects; no acceptance criteria are relaxed.

## Add optional exact-monitor DXGI capture with fresh GDI recovery

Optional DXGI source is unaccepted until exact native CI and Owner hardware tests. Rotated outputs, unsupported adapters, lock/RDP/access loss and missing frames use explicit fresh-GDI fallback; mixed-DPI/multi-GPU/lock/driver recovery matrix remains Owner UAT. GPU resize, hardware encoding, H264/WebRTC viewer and zero-copy transmission are not implemented or advertised; MCP image/jpeg consumers continue working. Windows driver Map may block capture despite a16ms acquisition timeout; fast status/input lanes remain separate, and existing helper timeout reset/reobservation is required. Full dependency graph must be committed from Actions before a final candidate. CI106 text mismatch is not fixed by this capture change.

## Wait for native text delivery and fence expired input authority

The new delivery/backpressure implementation is source-tested but real16K/64K/256K typing has not yet passed native CI. Unavailable readback remains unverified; no complete-content claim is made from event counts. Windows foreground/OS input stream is shared, and already accepted events cannot be recalled on a later user focus switch; bounded chunks/readback reduce backlog while preserving local user input and Agent sessions. Strict authority deadlines may safely interrupt a slow/queued chunk and require observation/reconciliation rather than continuing blindly. Large existing documents/slow providers may incur readback cost or watchdog reset. GPU native compile/probe and controlled timing remain pending after the explicit overload correction; no hardware/video/resize/encoder acceptance is inferred from a locked dependency graph.

## Keep RM capture cleanup responsive and correct native measurements

CI109 actualDXGI capture/fallback proof does not establish Owner GPU, multi-monitor/HDR/rotation/driver recovery or speed improvement. Its prior-source capture timing was invalid due missing field; corrected shared handler timing must be rerun. Native long-text delivery after backpressure remains unaccepted because CI109 stopped before the text fixture. Capture cleanup may remain pending during a genuinely stuck native driver; helper recovery remains necessary, but status/expiry/close no longer wait on capture gate.

## Amortize verified text windows without dropping target checks

CI110 real16K/64K writes passed native/full fixture readback, but256K did not complete within15minutes. New window/check amortization is pending native measurement, not accepted yet. Exact source capture benchmark improved in this one-run30sample GDI/pipe comparison; do not generalize to network/Owner/GPU performance. Native newline variants, provider/app diversity and physical focus-switch races require further scoped acceptance; no claim that queued input can be recalled.

## Fence new text packets while completing read-only verification

CI111 expedited16K/64K exact readback to22.49s/86.42s on that runner but stopped at65946accepted units because the mutation freshness timer also covered completion. New completion separation is pending native CI and does not claim256K success. If expiry occurs before another packet or during actual packet delivery, it must still stop unsent content and require reconciliation. UIA providers may block beyond the polling interval; native helper timeout/reset remains the recovery boundary. Read-only completion cannot retract already queued OS input or guarantee independent Windows focus.
