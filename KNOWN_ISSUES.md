# Known issues and remaining verification

| Item | Current evidence | Next action |
|---|---|---|
| Native end-to-end/new backend | CI native/install/rollback PASS; real backend/Agent API21 PASS separately; not one physical authenticated GUI acceptance | Prepare controlled routing and isolated Windows state for one acceptance round |
| Candidate exposure/profile | Retained Docker network internal; no host ports; Windows artifact retains canonical GoldABV2 Lab profile | Do not claim installing against old Lab tests the new backend; provide controlled candidate transport first |
| Wall SSO local integration | Backend mTLS issue positive/negative PASS; local Agent/browser bootstrap production wiring unfinished; UI SSO candidate remains disabled | Finish real native/Agent/Wall wiring with live family and device signature checks |
| New signed B/remote command | Actual candidate Agent enrollment/heartbeat/connect PASS; new live B grant/command not exercised | Exercise both Wall/account approval flows on an isolated enrolled device |
| Continuity | Source restored; optional modern Wall/core hook absent; P1 gets404; module regression references old Git history | Complete hook/package closure, replace old-history dependency with a pinned fixture; Windows DACL remains unverified |
| Extensions | Existing GoldABV2 LM0.3 retained and integrity/manual-staging source contract PASS; separate legacy LM0.2 restored | Verify real Chrome/current Wall compatibility; do not enable legacy product bindings as GoldABV2 |
| RC50/Guest | Missing portability/prototype source recovered; Guest native wiring incomplete | Keep Guest044 deferred; do not simulate readiness with SQL-only ledger changes |
| Mac/Linux packages | Locked native source builds/tests PASS | Full current installers still NOT_BUILT |
| Windows primary candidate physical acceptance | One LightRemote.exe implemented; CI #30 actual install/GUI/Agent restart/bridge upgrade/reinstall/rollback/watchdog/uninstall PASS | Focused isolated Owner/account/vault/B acceptance remains NOT_RUN; old helper installations take the pinned bridge first |
| Endpoint/schema catalog | Critical V4 catalog/version/handler wiring exists; legacy schemas and some authorize/SSO/Wall route constants remain | Finish full catalog coverage; do not promise every URL/path can already change from JSON alone |
| Runtime drift/data migration | Lab43+Owner, UAT42 without Owner; Lab source stages mixed | New runtime/data migration plan after acceptance; no overwrite of old paths/databases |
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
