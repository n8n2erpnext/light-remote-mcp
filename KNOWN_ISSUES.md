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
