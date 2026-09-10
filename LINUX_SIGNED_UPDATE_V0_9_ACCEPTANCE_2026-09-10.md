# Linux Signed Update v0.9 Acceptance — 2026-09-10

Status: **CLOSED on `codex/v0.9-device-policy-resume`**

This checkpoint closes the VPS-AMD Linux live-migration and signed-update/rollback gate for the v0.9 preview. It does not promote `main` and does not cut a stable tag.

## Accepted path

`Wall -> Run signed update now -> maintenance session -> outbound AMD leaf -> sudo systemctl start --no-block gpt-operator-agent-update.service -> signed manifest/artifact -> versioned release -> service health gate`

The acceptance update channel was served only on the NetBird path at `100.94.184.141:5590`; GitHub Releases, `main`, stable channels, and tags were not used.

The AMD install layout is `/opt/gpt-operator-agent/releases/<version>` with `/opt/gpt-operator-agent/current` as the active symlink. Release payloads are root-owned and not writable by the normal agent user. The updater timer remains enabled and active.

## Wall maintenance proof

`deploy/scripts/live-v09-maintenance-update-trigger.mjs` logs into the real Wall, checks the target Linux policy includes `sudo-on-demand` and `systemctl`, calls the structured maintenance update action, then proves the generated maintenance session auto-closes after one finished job.

Final live trigger properties:
- target: `VPS-AMD` / `dev_700ad1e57b626a18ffad9339`
- maintenance job completed with exit code 0
- session stats: one job started, one job finished, zero errors
- target remained online after maintenance

The action is therefore a real privileged execution path controlled through Wall policy, not a UI-only control.
## Good update proof

The signed `0.9.0-rc.1` acceptance manifest and artifact both verified before activation. The Wall maintenance action then moved the real AMD leaf from `0.9.0-dev` to `0.9.0-rc.1`.

Observed live state after the update:
- `current=/opt/gpt-operator-agent/releases/0.9.0-rc.1`
- device status reports `version=0.9.0-rc.1`
- systemd reports `ActiveState=active`, `SubState=running`, and a non-zero MainPID
- updater journal records `updated:0.9.0-dev->0.9.0-rc.1`
- Device Policy revision 3 remains effective with the original seven Linux grantable/approved capabilities

## Defects found by live acceptance

Two updater defects were found before release and are guarded by tests.

First, systemd invokes the updater through `/opt/gpt-operator-agent/current/...`, but the old ESM entrypoint compared the unresolved `process.argv[1]` path with the canonical `import.meta.url`. Through the `current` symlink the comparison failed, so systemd reported a successful oneshot while updater `main()` never executed. The entrypoint now compares real paths and `selftest-linux-updater-version.mjs` executes the updater through a symlink as a regression proof.

Second, the original post-restart gate could accept a broken release during systemd's transient startup window. A deliberately broken `0.9.0-rc.2` bundle had valid manifest signature, artifact hash, size, and package schema, but its bundled Node runtime was non-executable. The old gate briefly observed the service as active and accepted it.

The updater now requires a stable service state: `ActiveState=active`, `SubState=running`, non-zero MainPID, sustained for the health window. Rollback is also required to restore that stable state before the updater returns the expected failure.
## Broken-update rollback proof

The repaired updater was packaged into the live `rc.1` baseline, then the signed broken `0.9.0-rc.2` fixture was served through the same acceptance channel and triggered by the same Wall action.

Final rollback evidence:
- updater exits with expected failure `update_failed:update_rollback:0.9.0-rc.2`
- oneshot result is `exit-code` / status 1, so failure is externally visible
- `current` returns to `/opt/gpt-operator-agent/releases/0.9.0-rc.1`
- AMD agent recovers to `active/running` with a real MainPID
- serving signed `rc.1` again produces `up_to_date:0.9.0-rc.1` and a successful updater result

This proves rollback occurs after integrity verification and activation failure, not only on download/hash/signature failures.

## Regression and fleet soak

Final branch regression on ARM: `36/36` `deploy/scripts/selftest-*.mjs` PASS, zero skips and zero failures.

Fleet refresh was sampled in three consecutive rounds with zero active sessions. ARM stayed online at `0.9.0-dev`, AMD stayed online at acceptance `0.9.0-rc.1`, and the enrolled Windows x64 leaf stayed online at `0.9.0-dev`.

AMD soak sampled three rounds with the same healthy MainPID, `active/running`, updater timer active, no drain state, and `current` fixed at `rc.1`. Windows capability acceptance was rerun twice and passed filesystem, PowerShell, Git/bundled Node, process/network, Services, Event Log, and package-manager probes.

## Release boundary

Linux live migration and signed rollback acceptance are technically CLOSED for the v0.9 preview. The `0.9.0-rc.1` name used here is an acceptance fixture, not a published stable release. Production promotion still requires owner approval and the normal branch/release process; `main`, stable tags, and GitHub Releases remain untouched by this checkpoint.
## Post-acceptance release-channel cleanup
After rollback acceptance closed, AMD was moved off the temporary NetBird fixture URLs and back to the canonical GitHub Release manifest/signature URLs using a transient root systemd maintenance unit launched through the governed leaf execution path.

A Wall maintenance trigger against the canonical channel completed successfully and the updater reported `no_update_manifest`; AMD remained on healthy `0.9.0-rc.1` with the timer active. The temporary ARM HTTP fixture listener on port `5590` was then stopped.

This cleanup is release preparation only. It does not publish a GitHub Release, promote `main`, or cut a stable tag. See `V0_9_RELEASE_REVIEW_2026-09-10.md`.
