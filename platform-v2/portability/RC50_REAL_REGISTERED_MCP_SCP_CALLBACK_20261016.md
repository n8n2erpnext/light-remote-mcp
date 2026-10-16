# rc.50 P0-E / SCP registered MCP callback integration UAT — DEV only

Date: 2026-10-16 Asia/Ho_Chi_Minh
Previous feature HEAD: `d200ddceef9a6408c916a32819b24ee9d1e19660`
Branch: `feature/rc50-mjs-scale-20261011`
Status: source-level actual MCP callback contract and synthetic native-leaf byte integrity proven. **No production deployment, live Operator/Agent end-to-end or P0 release acceptance.**

## Why this test is materially different from previous pure helper tests

Previous `scp-plugin-chunk-integrity.test.mjs` called a pure adaptor directly and then `LightScpRegistry`. This turn validates actual **`registerPluginTools(server, identity)` definitions and callback handlers**, including permission checks, `scpOperation` branching and `AccountOperatorAdapter.scp` invocation. The only mocked boundary is `AccountOperatorAdapter.prototype.scp`, which is swapped temporarily in the *isolated test process*, not a real device or service.

`platform-v2/test/scp-registered-mcp-callback.test.mjs` includes:

1. Real tool schema advertising a `sha256` OPTIONAL Zod field, accepting omitted hash, verifying valid explicit hash, denying bad explicit hash.
2. Actual registered `light_remote_scp_upload_chunk` callback with `sessionId/operationId/transferId/index/data` and no chunk sha, under a synthetic `remote:write` identity. An intercepted synthetic Operator adapter receives exactly one envelope containing canonical computed `sha256` for the raw bytes, preserving operation ID.
3. Incorrect explicit SHA is rejected by the genuine registered callback before it reaches the synthetic Operator adapter, with no side-effect call.
4. A 140,011-byte cryptographically random binary file is transferred through the genuine registered MCP callbacks `light_remote_scp` (begin), `light_remote_scp_upload_chunk` (3 chunks), `light_remote_scp_upload_commit` (commit). Only the cross-service Operator method is mocked; from there the actual `LightScpRegistry` and `LightScpFileRegistry` stage chunks and atomically commit into a completely private temporary scratch file. Final binary bytes compare EXACTLY and whole-file SHA-256 matches. The mock confirms every chunk includes a 64-hex hash, which older leaf implementations required.

## Limitations and explicit open defects

The installed remote plugin currently still rejects a tiny valid upload chunk with `scp_invalid_sha256` (from prior direct official Light Remote UAT), and **this change only adds tests**, not the source patch that was already committed in `d200ddc`. The test does not traverse real Operator HTTP authentication, actual signed Fleet, deployed Agent binary, old leaf package, or a remote filesystem over WAN. An injected prototype intercept is not a faithful proof of network serialization or a production canary. Only owner-approved canary installation and actual two-host signed channel success can close live SCP compatibility.

One real SSH/PTY/Agent security boundary was intentionally NOT invoked: previously policy-denied source paths remain untouched. The tests run under synthetic identity and private temp path; no real OAuth token, device, customer or live code is involved.

All P0-A/B/C/D/E gates remain **NOT_READY**. Prior native PG17 and Redis8 restoration across physical VPS-ARM→HOMELAB x64 with invented data remains a subset success, not an authenticated writer cutover. Source writer audit remains 16/18 fsync proven, global single-writer authority absent.

## Next useful engineering

1. Owner-approved isolated canary with production-equivalent Agent binary and `d200ddc` Plugin adapter: verify actual public SCP chunk against 5-byte and 3-chunk binary, full-file SHA, retry, cancellation and no unauthorized device writes.
2. Separate independent WriterEpoch authority and global OLD writer revocation across Operator, Plugin, Fleet and Agent; do not authorize target start from synthetic local freeze or this callback unit PASS.
3. Complete signed Agent effect lifetime/ownership inventory and data migration before P0-D/E closeout.
