# G3 Gold — Separate Operator/Server CI from legacy host workflows

Date: 2026-10-20 | Branch `feature/light-remote-gold-rebuild-20261018`
Related fix: `6b4759a` G3 reconnect stale-readiness race.

## Observed, not inferred
Gold source `6b4759a` triggered four workflows after adding the Gold branch to the generic `Linux Server Bundle` workflow:
- Linux Desktop [#285](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828124): x64 and ARM64 SUCCESS.
- macOS [#243](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828056): Intel x64 and Apple Silicon ARM64 SUCCESS.
- Windows [#447](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828116): in progress at checkpoint; do not claim success before complete.
- **Legacy Linux Server Bundle [#310](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828227): FAILURE**; audit-selftests failed in legacy-config integration suite and x64 build failed at `selftest-host-install-layout.mjs` `host_installer_missing_executor_import:gold-db.mjs` before server packaging. ARM64 was cancelled by fail-fast; not a pass. This is a legacy workflow contract mismatch exposed by running Gold against it, not a proof that G3 reconnect patch itself failed.

## Direct source fix
`operator-host/executor.mjs` imports Gold persistence modules, but `deploy/scripts/install-host.sh` copies a stale hardcoded `lib/` list. Narrow fix adds the five actually imported files to both host executor and host-wall install lists:
`gold-db.mjs`, `gold-job-ledger.mjs`, `gold-registry-persistence.mjs`, `gold-session-redis.mjs`, `team-oauth-principal-proof.mjs`.
`deploy/scripts/selftest-host-install-layout.mjs` contract list updated to match. VPS-ARM `node deploy/scripts/selftest-host-install-layout.mjs` PASS and `bash -n deploy/scripts/install-host.sh` PASS. This changes only the Gold source branch, **not deployed installer files**.

## CI isolation correction
Do NOT make the generic legacy Linux Server Bundle run for Gold; removed the accidental Gold branch trigger. Keep its failing #310 audit on record rather than marking it fixed or skipping necessary product acceptance.

Added isolated `.github/workflows/gold-g3-operator.yml`:
- Gold branch only; manual dispatch.
- `gold-operator-contract`: Node source syntax, G3 router / half-open / rejected executor / hung executor / real TCP in-flight reconnect, legacy host install source contract, staged shared Client core digest verification. No cloud credentials required.
- `gold-uat-server-bundle`: x64/arm64 build-only package checks, sha256 and presence of Gold storage + duplex route modules. Artifacts are retained for 7 days, **no deploy, no release, no updater**.
- Genuine PostgreSQL/Redis, entitlement, signed Agent enrollment, and on-device diagnostics remain acceptance on the isolated `light-remote-gold-uat` LXD; CI source tests cannot replace that.

## Boundary and next step
Check exact GitHub Actions runs and logs for the new workflow after push. If a test fails, fix only the source-supported contract without editing production. Existing Gold LXD 5/5 services were active and real Operator IPC returned HTTP 200 at prior check; staged real duplex fixture passed there. G3 still needs enrolled disposable-node fault injection and soak. Existing untracked Gold UAT helper files remain untouched.


## Follow-up CI acceptance (same day, verified)
- Corrected Gold branch installer/source mode and pushed `8be53bd`, followed by `3c0b89d31f05e635ad6bed75d1fad7281a5e6f73` (restores executable mode `100755` on `deploy/scripts/install-host.sh`).
- The dedicated [Gold G3 Operator Regression #2](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39415783519), at exact SHA `3c0b89d`, completed **3/3 SUCCESS**:
  - `gold-operator-contract` PASS, job log explicitly contains the three G3 reconnect markers, installer source contract PASS and staged Client core verification PASS.
  - `gold-uat-server-bundle (x64)` PASS with source module and checksum contract.
  - `gold-uat-server-bundle (arm64)` PASS with source module and checksum contract.
- At original reconnect commit `6b4759a`: Linux Client [#285](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828124) x64/ARM64 **SUCCESS**, macOS Client [#243](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828056) Intel/Apple Silicon **SUCCESS**, Windows Tray Client [#447](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39414828116) **SUCCESS**; logs individually verified to contain all 3 new reconnect markers.
- Generic legacy Linux Server Bundle #310 remains **FAILED** (historical; do not overwrite this result). It is no longer the Gold branch validation lane. No live deployment, updater or client install was performed by this CI work. Real Gold Operator and DB live UAT remain a separate gate.
- **G3 not complete**: real disposable enrolled Gold Agent fault injection, independent readiness evidence and measured soak still need acceptance. These are not substantiated by source-only CI or TCP fixture in LXD.
