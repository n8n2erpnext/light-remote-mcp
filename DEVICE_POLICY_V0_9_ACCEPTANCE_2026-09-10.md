# Device Policy v0.9 Acceptance — 2026-09-10

Status: **CLOSED on `codex/v0.9-device-policy-resume`**

This checkpoint closes the owner-controlled Device Policy feature that had been paused at `24fe54a` while native Windows packaging/persistence was prioritized.

## Accepted authority model

`owner policy -> Hub approved-capability boundary -> signed policy revision -> outbound device sync -> platform adapter inference -> device-local final deny -> native executor`

Caller-supplied `requiredCapabilities` remain advisory/minimum metadata. The device independently infers capabilities from the script before spawning a process.

Device-local deny remains authoritative even when the Hub or caller understates requirements.

## Static and package gates

- Resume was rebased conceptually onto the current packaging line by branching from `codex/v0.9-client-packaging` and cherry-picking the paused policy checkpoint.
- Cherry-pick completed with zero conflicts.
- Final repository gate: `34/34` `deploy/scripts/selftest-*.mjs` PASS.
- Root `npm audit --omit=dev`: 0 vulnerabilities.
- Gateway `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: clean.
- Windows Native Client Actions run `34448964478`: SUCCESS through publish, install, legacy migration, installed self-test, forced update rollback, uninstall, hash, and artifact upload.
- Linux Client Packages run `34448964469`: x64 SUCCESS and arm64 SUCCESS.

## Legacy-state migration

Live enrollment state predates Device Policy fields. Migration was rehearsed against a copy of the real state before activation and then hardened so normalization is persisted atomically.

Active bindings migrated as follows:
- Windows `dev_ffc2a5da8b9e0f75fd9f3508`: revision 1, grantable 8/8 = approved 8/8.
- VPS-AMD `dev_700ad1e57b626a18ffad9339`: revision 1, grantable 7/7 = approved 7/7.

Revoked legacy proof devices remain revoked and are not reactivated by migration.

## Live Windows policy proof

Target: `DESKTOP-VA16D27` / `dev_ffc2a5da8b9e0f75fd9f3508`, native agent `0.9.0-dev`.

Original policy revision 1 approved `package-manager`. The owner plane removed only that capability, producing revision 2. The signed revision synchronized to the outbound Windows agent before execution.

The production execution lane then submitted `winget --version` while caller metadata declared only `filesystem` and `powershell`.

The Windows adapter independently inferred `package-manager` and denied locally:
- job `c7d91781-8ea2-4608-b8fd-baf3b01858f3`
- route `outbound-leaf`
- exit code `126`
- stderr `local capability denied: package-manager`

The exact original capability set was restored by the acceptance script in a `finally` guard, producing revision 3. The Windows agent reported `package-manager` effective again before the recovery command was allowed.

Recovery proof:
- job `197298c5-d637-438d-91a8-dfbc3c03ec34`
- route `outbound-leaf`
- exit code `0`
- stdout `v1.29.290`

After the proof, live and persisted policy both report revision 3 with the original eight approved/grantable capabilities. The Windows node remains online.

## Deployment defects found and closed during acceptance

Three real deployment defects were discovered while activating the paused feature:
1. Legacy policy normalization was initially memory-only; migration now persists normalized fields to disk.
2. `deploy/scripts/sync-gateway.sh` did not copy `device-policy-page.mjs`; the sync contract and regression now cover it.
3. `gateway/Dockerfile` did not package `device-policy-page.mjs`; this caused an `ERR_MODULE_NOT_FOUND` restart loop during acceptance and is now fixed with regression coverage.

The Gateway recovered to `v0.9.0-dev`; MCP health and Wall auth boundaries are healthy. Vercel reported no runtime error clusters in the final one-hour acceptance window.

## Closure assessment

Device Policy v0.9 is technically CLOSED: owner changes are bounded by grantable capabilities, revisions are signed, stale devices receive policy before command execution, local platform inference prevents caller understatement from bypassing policy, restore/recovery is proven, legacy state migrates safely, and audit attribution remains target-bound.

At the moment this Device Policy checkpoint closed, this did **not** promote all of v0.9 to production: `main` remained owner-controlled, no stable tag was cut, and VPS-AMD was still on agent `0.8.0-dev`, leaving the separate Linux live-migration gate open. The post-closure note below records the later closure of that gate.

## Post-closure Linux migration note

The broader Linux gate referenced above was closed later on 2026-09-10 without changing the Device Policy acceptance result. VPS-AMD is now live on the v0.9 packaged layout with policy revision 3, root-owned releases, and the signed updater timer active.

The structured Wall maintenance path updated AMD from `0.9.0-dev` to signed acceptance `0.9.0-rc.1`. A subsequent signed/hash-valid but intentionally broken `0.9.0-rc.2` activation failed the stable service-health gate and automatically rolled back to healthy `rc.1`. See `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md` for the updater defects, rollback proof, and final 36/36 regression/fleet soak.
