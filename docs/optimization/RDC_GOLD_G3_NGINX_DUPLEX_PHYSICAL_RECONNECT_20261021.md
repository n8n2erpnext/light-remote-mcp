# GOLD G3 — 2026-10-21 Gold-only Nginx stream correction and physical Windows Duplex reconnect

Scope: `feature/light-remote-gold-rebuild-20261018`, **isolated Gold Preview only**.
Starting Git source: `ff832f32ba4988ed879fff2c01a695ecf1e44320`.
Installed Gold LXD Operator/Plugin/Wall candidate: `15eed24fa400feccfb6156df7959c78a8aa437af` (NOT changed here).
Owner Windows `DESKTOP-VA16D27`: installed Windows CI #453 (NOT reinstalled).
Production `light-remote-direct`, Paddle and unrelated Nginx instances: no mutation.

## Causal RCA — previous live failure and exact Gold edge

The prior read-only physical RM V2 live-open returned `transport=semantic-push-cache`, `DeviceDuplexClient.active=true, ready=false, bytesReceived=0, lastReadyAt=0`, with Windows Agent log showing 4 `device_duplex_ready_timeout`. Gold Operator activity recorded no successful `device_duplex_opened` in the earlier 240 sampled events. Signed HTTP poll (normal exec) still worked, so readiness 2/2 was not proof of Duplex.

Gold public `https://gold.light-remote.thaiduy.digital/` returned HTTP 200 with `Server: nginx`. The Gold-specific Docker container is `light-remote-gold-preview` (Compose project `light-remote-gold-demo`, service `preview-proxy`), **separate from production**. Its read-only mounted config came from `deploy/gold-demo/nginx-gold.conf`. Existing Nginx general `location /` had `proxy_http_version 1.1;` and **response** `proxy_buffering off;`, but no `proxy_request_buffering off;`; request buffering defaults to ON. This matters because Agent opens an indefinite chunked POST `/device-channel/stream`, which cannot finish the request body before receiving `hello-ack` (deadlock if a proxy waits for full request body). Nginx docs: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering .

The deployed Gold transport is managed on VPS-ARM through NetBird / Traefik, Gold Nginx -> `10.192.135.61:5583` (Plugin) -> Gold Operator Unix IPC. The proven failure point was **request buffering in Gold Nginx**; G3 does not require an additional public proxy or WAF.

## Gold-only fix / safe maintenance

- Backed up original Gold Nginx config to `/home/ubuntu/.cache/light-remote-gold-uat/nginx-stream-g3-20261021/nginx-gold.conf.before`, original SHA256 `bf2f537bf50efcacbdb1f6bea4047632d1971d2bfe48b1e52c77d066d249c8e0`. No private keys copied.
- Added dedicated exact `location = /device-channel/stream` in `deploy/gold-demo/nginx-gold.conf` with `proxy_http_version 1.1;`, **`proxy_request_buffering off;`**, **`proxy_buffering off;`**, same Host/X-Forwarded headers/timeouts and Gold noindex headers. General `location /` remains unchanged — no broad unbuffering for authentication, billing, uploads or other routes.
- Source patch SHA256 `d975d972f2200caa0dc94a595bebd697e57016af6972541a68cf718dba35c262`. First edit was not visible inside running container because `default.conf` is a read-only bind mount of an older inode; **a plain Nginx reload would NOT apply it**.
- Confirmed Docker Compose project and service labels. Checked Fleet **2/2 ready**, 0 queued/inFlight, 0 active sessions after closing only our Gold Windows MCP session; strict OFF.
- Recreated ONLY `preview-proxy` using the existing Gold-specific Compose (`up -d --no-deps --force-recreate preview-proxy`) to bind new config. Live container `nginx -t` PASS; Gold public HTTP 200 in **10 consecutive health samples**. The other Compose service `wall-netbird-proxy` was NOT recreated, and no production resources were restarted.
- Static source regression `deploy/scripts/selftest-g3-gold-preview-stream-config.mjs` checks exact scoped stream location and required request/response buffering mode, while asserting general location is not globally unbuffered. PASS on VPS-ARM. Added to Gold G3 CI with path trigger for `deploy/gold-demo/nginx-gold.conf`; YAML parse PASS.

## Real physical Windows/Gold acceptance (not a synthetic TCP fixture)

**After Gold-only Nginx change**, a new authorized, **read-only** Windows RM live-open (`windows-uia`, maxDepth=1, maxNodes=10) reported:

- `transport=device-duplex-v1`, **`duplex.active=true, duplex.ready=true`**, `connects=1`, `bytesReceived=2188`, nonzero `lastReadyAt`. Previously the same physical Agent failed to receive any hello-ack and fell back to semantic-push-cache.
- Gold Operator activity now recorded `device_duplex_opened` / `device_duplex_closed`, unlike prior zero opens.
- To test actual network interruption, opened another read-only RM lane, preflight checked Gold **2/2 true, queued/inFlight=0, strict OFF, only our one active session**, then restarted **only** Compose `preview-proxy`. Gold site recovered and stayed HTTP 200 for **10 consecutive samples**.
- Operator activity after fault: `device_duplex_opened=4`, `device_duplex_closed=3`, `device_duplex_error=1` in sampled activity; latest events include closed/error and a subsequent new opened stream.
- Re-entered read-only live-open on the **same real installed Windows Agent** and observed `transport=device-duplex-v1`, `ready=true`, **`connects=2, reconnects=1, disconnects=1`**, `receiveStaleDisconnects=1`, bytesReceived=25284, new nonzero `lastReadyAt`, lastInboundAt updated. Agent recovered without new A/B or local identity changes. `serverEpochChanges=0` is expected because we restarted proxy only, not Operator.
- Closed the trial RM live lane via official `light_remote_desktop_live_close`, no mouse/key actions and no user desktop modifications.
- Final checks: isolated Gold LXD **5/5 services active**, Gold public HTTPS **200**, production public HTTPS **200**, live Nginx config contains exactly the scoped `proxy_request_buffering off`, Fleet **2/2 fresh and ready, queued=0, inFlight=0, strict OFF**.

**Acceptance label:** **PASS (Gold live physical)** for signed channel establishment as implemented (the Agent sends its existing signed stream hello), recovery of active Duplex channel after Gold proxy interruption, and responsive transport. **Not proof** of cryptographic nonce replay rejection against a malicious actor, in-flight external shell effect exactly-once, late result receipt across interruption, or long-running RSS/performance soak. During observation, some transient Duplex errors occurred as expected; they must not be concealed.

## Remaining ordered G3 gates

1. Real enrolled Windows Agent in-flight **late receipt / possible duplicate** while physical Duplex transport is interrupted; use bounded reversible/read-only effect with explicit command ID, no fabricated success and no replay. Respect actual device policy and ChatGPT platform denials.
2. Bounded physical installed-Agent sampling with N/p50/p95, RSS/bytes, reconnect counters, orphan count. Existing loopback fixtures are not a substitute.
3. Once all evidence PASS: controlled Gold-only strict admission `OPERATOR_REQUIRE_EXECUTOR_READY=1` under backup, true zero-work, 10-sample health and rollback gate; verify unknown/false denied HTTP 409 and true admitted. **Not enabled here**.
4. G3 DONE only when all physical acceptance gates met; **G4 not started**. Preserve four pre-existing untracked UAT files.

Backup rollback if Gold preview regression: restore ONLY `deploy/gold-demo/nginx-gold.conf` from the path above and recreate only Compose `preview-proxy` with `--no-deps`; verify 10-sample Gold HTTP health. Do not restart production or introduce another proxy as a workaround.

Historical preceding RCA (pre-fix): [RDC_GOLD_G3_PHYSICAL_DUPLEX_HANDSHAKE_RCA_20261021.md](./RDC_GOLD_G3_PHYSICAL_DUPLEX_HANDSHAKE_RCA_20261021.md).
