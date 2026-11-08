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
| Windows two primary EXEs | C# host plus Tauri UI retained to preserve current behavior | Single LightRemote.exe is a later product architecture task; Node/RM/updater may remain separate |
| Endpoint/schema catalog | Critical V4 catalog/version/handler wiring exists; legacy schemas and some authorize/SSO/Wall route constants remain | Finish full catalog coverage; do not promise every URL/path can already change from JSON alone |
| Runtime drift/data migration | Lab43+Owner, UAT42 without Owner; Lab source stages mixed | New runtime/data migration plan after acceptance; no overwrite of old paths/databases |
| Repository reset capability | Git SSH push works; create/delete/admin export not established; browser timeout | Resolve recreation/config/secret restore preflight before any final Owner reset confirmation |
| Windows current process inventory | WMI process read denied; binary file identity and historical artifact available | Keep runtime provenance UNKNOWN where unsupported; no privilege bypass |

Resolved: stale Owner Cargo.lock made previous native builds resolve dependencies outside the committed graph. Reviewed lock committed; --locked and strict post-build source provenance PASS in final CI. Actual original Wall wrapping/module-state/B fixes were inherited from tested T11 source; reconstruction did not change the Owner's installed app or old server.

DEV helper scope: status displays the last deployment receipt, not a liveness probe. Use labelled Docker inspection for actual running state. Run disposable test before retaining a start candidate; the helper's latest pointer is shared by invocations. This helper remains a DEV tool, not a production service manager.
