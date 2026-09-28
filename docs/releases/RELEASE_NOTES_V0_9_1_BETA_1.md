# Light Remote MCP v0.9.1-beta.1

Stable/Core normalization beta.

## Scope
- Core remote execution, Local Wall, Fleet, pairing/helper, updater and normal distribution paths.
- HTTP 410 stale hard-lease handling retained.
- Vercel Agent-client 401 transport hardening, deterministic connection helper and deploy continuity retained.
- Transition compatibility floor is 0.9.0-rc.26 so the current proven clients remain supported during rollout.
- Current Wall UI retained: Cascadia Mono, native operation labels, risk badges, shell/terminal syntax rendering, activity history, UTF-8 preservation and binary-output suppression.
- Real Remote is intentionally excluded from this beta.
- The Netlify backup lane is retired and excluded from this beta.

## Provenance
- Clean pre-Real-Remote base: bf20fc01fd5585cff15618f78d26587517665ff0.
- 410 fix anchor: c21df07.
- 401 transport anchor: 05c3bb1.
- connection-helper determinism: 5d70192.
- Vercel client continuity: bf20fc0.
- UI/Core patchset: 8546864, 40dca94, fea2097, 95f32b9, 57e6411.
- Desktop/Real Remote residues from the historical UI branch were explicitly removed before release.

## Distribution
The prerelease is expected to include Windows x64 full/compact installers, macOS x64/arm64 packages, Linux x64/arm64 client packages and debs, Linux Server/Hub x64/arm64 bundles, the Vercel bridge bundle, and a universal Fleet Wall module.

Signed update channels are not promoted until immutable release artifacts pass size/SHA verification and real-device acceptance.
