# v0.9 Release Review — 2026-09-10

Status: **ENGINEERING GO / PROMOTION HOLD**
Branch: `codex/v0.9-device-policy-resume`
Live-acceptance content commit: `13aeb484808b94aaa005db2049f0045b1710a678`
Main reconciliation commit: `b1ae1fd`
Release-prep packaging/source commit: `119850ab242ae8dffeb7c6ca298b166db75462d2`

## Branch / ancestry
`origin/main` was not initially an ancestor of the v0.9 acceptance branch because the Light Remote MCP identity commits had landed independently on both lines. A no-content reconciliation merge was completed on the acceptance branch.

The reconciliation tree is byte-identical to the already-tested candidate tree:
`b1ae1fd^{tree} == 13aeb48^{tree} == a9bd4392b6b3e5d8abd4619f9b94e169986bf8b7`.

`origin/main` is now an ancestor of the acceptance branch, so a later owner-approved promotion can use the normal branch/release gate without replaying divergent history.

## Automated gates
Final ARM selftest gate: **36/36 PASS, 0 skip, 0 fail**.
Root `npm audit --omit=dev`: **0 vulnerabilities**.
Gateway `npm audit --omit=dev`: **0 vulnerabilities**.
`git diff --check`: clean.

GitHub Actions for the live-accepted candidate tree were green:
- Linux Client Packages run `34479343542`: **SUCCESS**.
- Windows Native Client run `34479343549`: **SUCCESS**.

The ancestry-only merge did not alter that tree. After the third-party notice packaging hardening changed the release package contract, CI was run again on commit `119850a`:
- Linux Client Packages run `34485046439`: **SUCCESS** for both x64 and arm64; build, package-contract smoke, and artifact upload all passed.
- Windows Native Client run `34485046414`: **SUCCESS** through publish, bundled-runtime notice smoke, installer build, installed-layout smoke, rollback smoke, uninstall, hash, and artifact upload.

The final release-prep package artifacts therefore come from the notice-hardened candidate, not only from the earlier acceptance tree.
## Live acceptance / recovery
Linux signed-update acceptance is closed on the real AMD leaf. Signed `0.9.0-rc.1` activated successfully; signed/hash-valid `0.9.0-rc.2` with a deliberately non-executable bundled runtime failed the stable service-health gate and automatically rolled back to healthy `rc.1`.

The updater defects found during live acceptance are fixed and regression-covered:
- ESM entrypoint detection now resolves the `/current` symlink before deciding whether to run `main()`.
- activation requires a stable `active/running` service with a non-zero MainPID; rollback must independently reach stable health.

Windows live acceptance and repeated soak passed across filesystem, PowerShell, Git/Node, process/network, Services, Event Log, and package-manager lanes. ARM, AMD, and Windows remained online with zero active sessions after cleanup.

## Update-channel cleanup
The AMD updater was cut over from the temporary NetBird acceptance fixture to the canonical GitHub release URLs using a privileged transient systemd maintenance unit launched through the governed remote execution path.

Post-cutover verification:
- updater timer remains active;
- AMD remains on healthy `0.9.0-rc.1`;
- the unit contains no `100.94.184.141:5590` acceptance URL;
- a manual Wall maintenance trigger against the canonical channel returned `no_update_manifest` and exited successfully;
- the temporary ARM acceptance HTTP listener on port `5590` was stopped.

## Security review
Tracked-source scans found no private-key PEM markers, GitHub/OpenAI-style token markers, or sensitive-name credential/key files. The only remaining `100.94.184.141:5590` reference in Git is historical acceptance documentation.

The update signing private key is not in the repository; signing requires external `CLIENT_UPDATE_SIGNING_KEY_FILE`. Only the update verification public key is tracked.

## Third-party binary notice gate
The release review found that binary packaging carried the application-specific NetBird notice but did not explicitly preserve the license/notice files for the bundled runtimes. That package-contract gap is now closed in source:
- Linux copies the verified Node.js archive `LICENSE` into `licenses/node/LICENSE` and CI requires it to be non-empty.
- Windows copies the pinned Node.js `LICENSE`, the .NET runtime `LICENSE.txt`, and `.NET` `ThirdPartyNotices.txt` into the installer; staging and installed-layout smoke both require the files.
- `THIRD_PARTY_DISTRIBUTION_NOTICES.md` documents the distribution layout and keeps runtime notices separate from the still-undecided Light Remote MCP project license.

This closes the mechanical third-party notice packaging gate; it does not substitute for legal advice or for the owner selecting the project's own root license.

## Promotion blockers / owner decisions
Engineering acceptance is green, but promotion is intentionally held at this checkpoint.

Two owner-level decisions remain before a stable public v0.9 release:
1. Explicit approval to promote the accepted v0.9 branch to `main` and cut the release/tag.
2. Select and add a project-wide root license. The repository is public, but there is currently no root `LICENSE`/`COPYING` file; README already warns that redistribution should not be encouraged until an explicit license is declared.

No `main` update, stable tag, or GitHub Release is created by this review.

## Release-ready next sequence
After the owner resolves the two decisions above: re-run the final branch gate if source changes, promote to `main`, verify the production Vercel/ARM path, build release packages from the promoted commit, sign the update manifest with the external signing key, publish the GitHub Release assets, verify the canonical updater channel, and only then cut/confirm the stable tag according to the chosen release convention.
