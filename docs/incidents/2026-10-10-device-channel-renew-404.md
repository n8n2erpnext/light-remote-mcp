# Incident LR-2026-10-10 — `/device-channel/renew` 404 retry storm

**System:** Light Remote Direct (VPS-ARM, LXD `light-remote-direct`), observed by Micro Sentinel Selene.  
**Status:** Production hub hotfix applied and verified; monitoring. Source client safeguard pending future release.  
**User-facing decision:** **Do not force updates or reinstall any existing client to resolve this incident.**

## What happened

On 2026-10-09 (Vietnam local time), NetBird Proxy recorded **10,820 HTTP 404** on `POST /device-channel/renew` from 10 source addresses, plus 8 responses of 502. The largest source accounted for 6,012 (55.6%) of the 404s. The VPS-ARM host device Agent itself logged 5,353 `device_connection_renew_failed` errors that day; client-side retries amplified the load. This incident is **operational retry traffic, not confirmed DDoS**.

## Root cause — two distinct defects

1. **Hub (caused HTTP 404):** Production ingress is `light-remote-direct-plugin.service` at port 5495, serving `plugin-server/device-public.mjs`. The `CHANNEL` action allowlist omitted `renew`, so the gateway rejected valid signed renewal requests with `404 device_channel_action_denied` before they reached the backend. The Operator backend already implemented `POST /v1/device-channel/renew`. The older `gateway/server.mjs` also lacked the route but **is not production ingress**.
2. **Client (amplified traffic):** Once a renewal failed, the device Agent retried on subsequent polling/command-liveness loops, often every 5–8 seconds, without failure backoff or single-flight protection.

## Hotfix and verification

- **Applied to production Direct plugin on 2026-10-10 ~01:40 Vietnam time:** added `renew` to `CHANNEL` allowlist; restarted only `light-remote-direct-plugin.service`, not backend, devices, or Sentinels.
- **Rollback backup:** `/opt/light-remote-direct/hotfix-backups/device-public.mjs.before-renew-route-20261009T184013` inside the `light-remote-direct` LXD. Avoid reverting unless necessary, because the old file reintroduces the 404.
- **Before:** `POST /device-channel/renew` with an unsigned empty payload returned 404 `device_channel_action_denied`.
- **After:** same unsigned test correctly returns **400 `invalid_device_channel_payload`**, proving request reaches backend authentication rather than being allowed without a signature.
- **Real traffic:** 178 responses 404 in 10 minutes before patch; then **three actual signed renewal requests returned HTTP 200, zero observed 404** in the post-patch observation window. ARM Agent journal showed zero new `device_connection_renew_failed` events since the fix; Direct plugin and backend remained active.
- These counts describe the verified observation window, **not indefinite monitoring or a promise of zero future errors**.

## Durable source fix

Branch: `fix/direct-renew-404-20261010` in `n8n2erpnext/light-remote-mcp`, commits `a3ffbeb` and `5836675`.

- `plugin-server/device-public.mjs`: add `renew` to allowed actions.
- `gateway/server.mjs`: add route for legacy/non-Direct deployment.
- `device-agent/operator-agent.mjs` and `lib/cloud-lease-renew-backoff.mjs`: bounded exponential retry delay (404 starts ~60s, max 10 min, jitter) and single-flight for main daemon + command liveness pulse.
- Regression: `selftest-direct-renew-route.mjs`, `selftest-cloud-renew-backoff.mjs`, and signed renewal verification in `selftest-v09-device-channel-connection.mjs`. Relevant tests **PASS**. A full portable suite attempt timed out in updater tests, so **do not claim full-suite PASS**.

## Do not forget on next release

1. **Persist the Hub hotfix in the next Direct server deployment.** The emergency patch modified the current LXD release; deploying an unpatched release could restore the 404. Require a release gate comparing plugin `CHANNEL` and Agent-supported actions.
2. **Ship the client backoff in a normal future update** after CI/canary approval. It is not required to resolve this incident immediately because Hub renewals now succeed. Do not automatically bump Windows/macOS clients due to this issue.
3. Monitor renewed 404/5xx rates, actual signed renewal success, lease expiry, and device online/offline stability. Keep Selene `OBSERVE_ONLY`; classify this incident as `operational_error/client_retry_loop`, not an attack without further evidence.

Full operational evidence and rollback details on VPS-ARM: `/home/ubuntu/handoffs/LIGHT_REMOTE_DIRECT_RENEW_404_INCIDENT_FIX_2026-10-10.md`.
