# Light Remote MCP v0.9.0 Release Candidate

Release-candidate build of the governed cross-platform remote execution and control-plane architecture.

## Included in this release candidate
- Device Wall for single-device approval, policy, activity, terminal, and maintenance flows;
- Fleet Wall for governed multi-device routing on entitled plans;
- outbound Windows, macOS, and Linux clients with persistent background agents;
- Windows x64 installer, macOS x64/arm64 packages, and Linux x64/arm64 packages;
- signed device identity, owner-bound sessions, explicit device targeting, and local policy enforcement;
- durable execution, terminal/PTY support, file transfer, Git/filesystem/process helpers, and audit telemetry;
- account/device session authority, OAuth/MCP integration surface, and Vercel bridge packaging;
- independent signed client updater with health gate, rollback, Update, and Force Update paths;
- signed Fleet component delivery with monotonic anti-downgrade protection;
- owner-controlled update promotion: immutable release artifacts, signed channel manifest, SHA/size verification, and fail-closed promotion.

## Distribution model
GitHub prerelease assets are the immutable binary origin for the beta/RC channel. The signed update manifest is the client trust pointer. Vercel remains a thin public bridge/control-plane adapter and is not used as a binary CDN.

This is a prerelease candidate. It is not a claim of stable/general-availability status, and it does not bypass the existing approval, policy, signing, or entitlement boundaries.
