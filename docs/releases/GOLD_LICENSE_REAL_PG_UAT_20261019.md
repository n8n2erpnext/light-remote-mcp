# Gold License — real PostgreSQL 17 durability UAT (2026-10-19)

Branch: `feature/light-remote-gold-rebuild-20261018`.
Isolated LXD: `light-remote-gold-uat`, private `10.192.135.61`.
Scope: License key inventory and redemption persistence through `GoldNativeLicense`; **not** real license issuance, billing or account-side redeem HTTP.

## Real UAT evidence

- Preflight `GOLD_LICENSE_UAT_PREFLIGHT`: 0 License rows, 0 redemptions, 0 synthetic accounts.
- Dedicated synthetic `example.invalid` account and non-usable synthetic SHA256-style License record inserted only into Gold PG 17.
- `GOLD_LICENSE_REAL_PG17_WRITE_READ=PASS`: write through `GoldNativeLicense.store.write()`, read back through `GoldNativeLicense.open()`; verified plan, duration, license hash, redemption account and relational row counts.
- Restarted **Gold UAT** Operator and Plugin through systemd. Both remained `active`.
- `GOLD_LICENSE_REAL_PG17_AFTER_RESTART=PASS`: same relational License and redemption read back after restart.
- `GOLD_LICENSE_REAL_PG17_CLEANUP=PASS`: synthetic License and redemption removed, synthetic Account removed.
- Restarted Gold UAT services once more; both `active`; final preflight verified all three synthetic record counts zero.
- Test source: `deploy/scripts/uat-gold-license.mjs` (staged as a standalone isolated UAT script in the Gold LXD), stages: `preflight|write|read|cleanup`. Requires real guarded Gold storage config. Rejects writes when any preexisting license rows exist; cleanup verifies exact expected UAT row counts before deletion.

## Architectural checks

- Relational tables `lr_gold_license_keys`, `lr_gold_license_redemptions` under migration 022; redemptions have an FK to `lr_accounts`.
- Test uses actual PostgreSQL 17 and Redis 8 admission, not a mock or file-backed JSON snapshot.
- No production database, LXD, public domain, Paddle account, live License key, or service changed.

## Separate outstanding acceptance work

- End-to-end license redemption via Account HTTP API and actual entitlement reconciliation **not tested** here.
- Pro Team relational persistence previously PASS, but direct Pro Team HTTP test remains unaccepted after an OpenAI safety denial for the API inspection command on 2026-10-19. Do not evade that denial by alternate execution mechanisms.
- Paddle subscription/event and rest of Gold domain API durability require independent UAT and fail-closed reviews.
- Gold is **not** accepted as a PostgreSQL/Redis-only cutover, and no public DNS target should be provided until the isolated full API is routable and all domains pass.
