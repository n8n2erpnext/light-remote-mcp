# Release BOM — 0.9.1-beta.1

## Canonical identity
- Version: 0.9.1-beta.1
- Client compatibility floor: 0.9.0-rc.26
- Release branch: release/core-0.9.1-beta.1
- Base: bf20fc01fd5585cff15618f78d26587517665ff0

## Required reliability anchors
- c21df07 — stale local hard lease / HTTP 410 prevention
- 05c3bb1 — Agent-client 401 transport hardening
- 5d70192 — deterministic connection helper
- bf20fc0 — client continuity across Vercel deploys

## UI/Core patchset
- 8546864 — filesystem activity + UTF-8
- 40dca94 — native activity group labels
- fea2097 — Wall history/activity ring
- 95f32b9 — Cascadia Mono + richer activity/terminal UI
- 57e6411 — UTF-8 split safety + binary-output suppression

The patchset is applied onto the clean pre-Real-Remote base. Desktop/Real Remote-specific render/activity branches are removed before release.

## Excluded
- Real Remote / UIA / desktop observation and input
- desktop live/duplex transport
- Real Remote Windows helper/runtime/tasks
- Netlify backup runtime and transport lane

## Retired Netlify allocation
- Former domain: https://nmcp.dashboard.thaiduy.store
- Reserved former Wall port: 5493
- Reserved former Fleet port: 5494
- See docs/operations/RETIRED_NETLIFY_2026-09-28.md

## Required release artifacts
1. Windows x64 full installer
2. Windows x64 compact installer
3. macOS x64 tar.gz + pkg
4. macOS arm64 tar.gz + pkg
5. Linux x64 tar.gz + deb
6. Linux arm64 tar.gz + deb
7. Linux Server/Hub x64
8. Linux Server/Hub arm64
9. Vercel bridge bundle
10. Universal Fleet Wall module
11. release-provenance.json
12. client-update-unsigned.json
13. SHA256SUMS.txt

## Promotion rule
Do not change the signed beta update pointer or production deployment until cross-platform CI, stable-scope gate, 410 regression, artifact hash verification and real-device acceptance pass.
