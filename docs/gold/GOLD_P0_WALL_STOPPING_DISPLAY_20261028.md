# Gold P0 Local Wall — truthful visible Stopping state

## Before
- Physical owner Kill on Win10 and Win11 previously verified `cancelled/130` with signed terminal results after `job-cancel` signed Gateway fix.
- Local Wall showed disabled `Stopping…` in Kill button while main job status still rendered `running`. This did not falsify terminal evidence, but was misleading for the owner.

## Source patch
- In `device-agent/local-wall.mjs`, compute a **presentation-only** `visibleStatus`: if `j.stopRequested && j.status==='running'`, render `stopping`; otherwise render the authoritative `j.status`.
- Display class and status text share `visibleStatus`, styled amber. The underlying status model remains `running` until a signed `job_finished` event arrives. On `job_finished`, stopRequested resets and the authoritative `cancelled` or other terminal status is rendered.
- Stop button remains disabled/`Stopping…` while request is pending, and no new Stop is submitted. After a declined Stop, the old `running` status remains and the button is available again.
- New `selftest-gold-wall-stopping-status.mjs` enforces this state separation and signed terminal reset. Existing Wall Navigation / device-channel Gateway tests PASS.

## Release scope
- Source-only on isolated Gold branch. No Windows/macOS client installation and no production rollout. Gold UAT four services remain SHA `c0c6977`; this change must be staged with a future same-SHA source release and physically observed before recording a real Wall Stopping visual PASS.
- HOLD: real Pro Team independent A/B devices and owner orphan claims. A/B V2 redesign postponed.
