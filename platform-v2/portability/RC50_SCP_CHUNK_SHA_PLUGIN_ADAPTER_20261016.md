# RC50 Light SCP — public chunk SHA-256 backwards-compatibility bridge (DEV only)

Date: 2026-10-16 Asia/Ho_Chi_Minh
Parent HEAD: `76fa4ef2614721f37ca870379a4fb2ffbcf9257c`
Branch: `feature/rc50-mjs-scale-20261011`
Status: **source-level Plugin adapter implementation and UAT tests PASS; installed plugin/device channel NOT upgraded or reverified**. No production deploy, main merge, Agent replacement or compatibility override.

## Reproduction on actual connected Light Remote runtime

A 5-byte file `hello` has whole-file SHA-256 `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`. An authorized upload to HOMELAB scratch UAT path via `light_remote_scp` began successfully. Its next public `light_remote_scp_upload_chunk({transferId,index:0,data:'aGVsbG8'})` returned `scp_invalid_sha256` (HTTP 400). The public installed tool definition advertises **no per-chunk `sha256` input**. The UAT upload was canceled, with no successful commit. The same fault occurred for a prior binary archive; changing to padded standard Base64 caused the **correct** `scp_invalid_chunk_encoding` error.

Repo code already shows a previous evolution documented in `docs/experiments/MACOS_RMV2_SCP.md`: older Agent-side `LightScpFileRegistry.putUploadChunk()` required a chunk hash, while current repo `lib/light-scp-file.mjs` can derive it when omitted. That explains one plausible deployed-version mismatch but does NOT prove the exact installed target binary/version or every intermediate serializer is responsible. Do not claim the installed plugin is fixed.

## New source change — plugin-server only, no lower validation weakened

- New `plugin-server/scp-chunk-integrity.mjs` exports pure `prepareScpUploadChunk(input)`.
- The helper enforces unpadded canonical Base64URL **strictly**, checks length before decoding, derives SHA-256 from **decoded raw bytes** (not encoded text or Unicode), validates an optionally supplied explicit 64-hex chunk SHA, compares it against actual bytes, and normalizes case.
- The public `light_remote_scp_upload_chunk` registration in `plugin-server/tools.mjs` now advertises optional `sha256`, without requiring it from existing clients.
- The central `scpOperation()` adapts just the `upload-chunk` operation to always forward a **canonical, valid computed `sha256` field** alongside `transferId,index,data`. Download, begin/status, cancel, commit and other tools remain unchanged.
- Current/older Agent can independently verify this chunk hash, and mandatory full-file SHA-256 remains verified by the leaf on commit. Invalid provided hash fails at the Plugin boundary and NEVER gets dispatched.
- No command replay, stop/start, credential, production binary or signing-key changes.

## Test evidence

New `platform-v2/test/scp-plugin-chunk-integrity.test.mjs` contains 8 tests: omitted hash derivation, explicit correct/uppercase hash, incorrect hash denial, blank hash denial, malformed/padded Base64URL, binary 0xff bytes vs Unicode, huge input refusal, actual `LightScpRegistry` owner-bound multi-chunk binary upload with final SHA commit and read-back, and fail-before-write+valid retry.
- Focused: **8/8 PASS**.
- Previous library optional-hash tests remain PASS (2).
- Full ARM64 Node `node --test platform-v2/test/*.test.mjs`: **103/103 PASS** (previous 95/95).
- Prior cross-host archive Python suites: **17/17 PASS**.
- P0 guards PASS; writer gap source audit still `fsync_proven:16`, `fsync_not_proven:2`, `single_writer_authority_proven:false`, status **NOT_READY**.
- Node syntax check and `git diff --check` PASS. Native ARM64 and x64 GitHub CI for exact resulting commit must be verified separately.

## Remaining acceptance

1. Build an independently isolated canary with the changed Plugin adapter AND representative older leaf runtime, then upload 5-byte file and binary multi-chunk; verify canonical final SHA, failure and retry.
2. Upgrade a nonproduction paired device on owner-approved release channel only, retest real connected `light_remote_scp_upload_chunk`; **do not silently restart or deploy production**.
3. Verify no hash checksum field is dropped/replaced through Plugin→Operator→signed Fleet→actual Agent and that old/new leaf versions both validate correctly.
4. Only after 1–3 above mark installed runtime Light SCP compatibility fixed. This checkpoint only patches source and passes isolated tests.

All P0-A/B/C/D/E remain **NOT_READY**. Light SCP functionality is not a substitute for cross-host global WriterEpoch, authentic owner B trust, signed Agent side-effect quiescence or whole-application restore/rollback.
