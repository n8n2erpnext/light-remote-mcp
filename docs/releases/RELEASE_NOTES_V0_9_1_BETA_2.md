# Light Remote MCP v0.9.1-beta.2

Golden-stack stabilization beta reconstructed from the proven deployed behavior while keeping the stable release source clean and reproducible.

## Reliability baseline
- Preserves signed lr1 Vercel client continuity used by the recovered production bridge.
- Adds late-result recovery for abandoned Fleet commands, preventing valid delayed device results from being lost after the in-memory command entry has expired.
- Packages the result-delivery helper required by that recovery path.
- Keeps compatibility with the 0.9.0-rc.26 transition floor while beta2 is validated.

## Wall polish
- Ordinary commands without a native PTY/FS/SEARCH/PROCESS/SCP badge now receive a neutral silver/black badge.
- Settings now has a matching icon.
- Copy cmd, Copy output, Copy raw, Copy visible, pairing, connect/disconnect, pause/resume, enrollment and navigation actions report through the Wall's own feedback UI.
- Refresh A performs a short 360-degree spin and reports completion.
- Manual held/orphan session cleanup is restored. Nothing is auto-closed, and sessions with active jobs cannot be closed from the cleanup UI.

## Stable release scope
- Stable/Core source and packages exclude the experimental computer-use runtime.
- The experimental computer-use line remains isolated on its development branch for later work.
- The Netlify backup runtime remains retired; its former ARM ports stay reserved for intentional future reuse.

## Promotion
This prerelease does not replace the recovered production Vercel/ARM golden runtime or promote the signed client update channel automatically. Promotion follows CI plus real-device A/B acceptance.
