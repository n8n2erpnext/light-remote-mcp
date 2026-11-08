# Gold P0 — durable signed result ACK / runtime cutover

## Source, risk and correction
- Gold isolated branch `fix/gold-windows-relink-rm-stability-20261028`, source commit `f6036431bb418a5c9af06c1c3ce8ed890f81f111`.
- Source audit: verified signed Agent result was acknowledged after synchronous `finishJob()` while `goldJobs.save()` was still pending; Fleet command was also marked completed before PostgreSQL commit.
- Changed `acceptDeviceResult` to async, confirm its job account/device matches the signed Agent and command, call `finishJob`, await `goldJobs.flush()`, then `fleet.complete`, finally return successful result ACK.
- Signed-poll route now awaits the async processor. Duplex onResult already awaits the callback. A rejected ledger flush yields no positive result ACK and no Fleet command completion.
- Regression `selftest-gold-device-result-durable-ack.mjs` executes the actual handler with deferred/failed ledger flush and cross-owner mismatch. No acknowledgement before commit; no completion when DB rejects; wrong owner rejected before mutation.
- Existing durable Cancel, job ledger and M6 terminal replay suites PASS.

## Real PostgreSQL38 safety fixture
- On the isolated LXD Gold UAT database, opened an explicit transaction with randomized UUID fixture, exercised real `GoldJobLedger` running -> `stopRequestedAt` -> cancelled/130 and checked persisted record after each flush.
- ROLLBACK performed; fixture existence check afterwards returned zero. No real job/claim affected.

## Gold UAT deployment
- Candidate staged under `/opt/light-remote-gold-uat-candidates/f6036431bb418a5c9af06c1c3ce8ed890f81f111`, preflight checked clean Git, zero queued/running personal jobs, no direct Supervisor children and exactly 3 pre-existing held resource claims.
- Snapshot `p0-before-f603643-durable-result-20261028` and rollback manifest `/home/ubuntu/handoffs/GOLD_P0_F603643_CUTOVER_20261028.txt`.
- Restarted Operator, Plugin, Wall and Process Supervisor to identical source SHA f603643; all active/nonzero PID: 1339423, 1339479, 1339510, 1339667 respectively.
- Readback after cutover: 3/3 claims retained, `running=2`, `terminal_unknown=1`; marker `P0_F603643_DURABLE_RESULT_ACK_CUTOVER_PASS`.
- Production and installed Win10/Win11 Agents unchanged.

## Post-cutover physical test limitation
- Existing authorized Win11 baolong123 connection resumed after Operator restart. Harmless job `03b0d7df-66a1-498a-a870-c435b28c71b3` was QUEUED under conservative M4 due historical `project:unknown` claim; cancelled before dispatch with verified true. Follow-up Job read returned terminal `cancelled`, `running:false`, `exitCode:130`.
- Do not describe this as a physical signed RESULT ACK success: the job was never dispatched. True Windows E2E for the new signed-result path remains **OPEN / BLOCKED_BY_HELD_RESOURCE_CLAIM**.
- Do not alter M4 locks or remove legacy claims for test convenience.

## Owner HOLD and future work
- Pro Team real multi-A/B client acceptance = HOLD_OWNER_RESOURCES; insufficient devices.
- Three historical worker claims = HOLD_EVIDENCE_AND_OWNER_AUTH. Release only with actual signed terminal or explicit owner-approved attestation and eligibility.
- A/B V2 redesign deferred. Windows installed-client graceful Stop / Wall Stopping physical verification remains separate, not claimed PASS.
- Continue independent P0 source or test fixtures with owned test scope. Keep actual runtime SHA distinct from later docs-only Git commits.
