# Gold Pro Team — PostgreSQL 17 real persistence UAT (2026-10-19)

Branch: `feature/light-remote-gold-rebuild-20261018`. LXD: `light-remote-gold-uat` (private 10.192.135.61), separate from production.

**Scope:** one item at a time. This checkpoint tests canonical Pro Team *database persistence*; it does not represent full public UI or Account Portal HTTP acceptance.

## Verified
- Read-only Gold connection: `GOLD_PG17_REDIS8_REAL_CONNECTED_AND_31_MIGRATIONS=PASS`, and legacy generic JSONB snapshot table absent.
- Before writing: seven Team data tables were empty. Owner/member were dedicated synthetic UAT accounts only.
- Executed `GoldNativeProTeam.store.write()` against **real PostgreSQL 17**, committing a Team owner, two active members, a Team entitlement (5,000-call budget), one hashed invitation, one notification read receipt, and one email invitation event.
- Reloaded data with `GoldNativeProTeam.open()` and checked actual relational rows: `GOLD_TEAM_REAL_PG17_WRITE_AND_READ=PASS`.
- Restarted only **Gold UAT Operator and Plugin** using systemd (both active afterward). Reloaded and verified account identities, Team membership, grant budget, invite, read receipt and email event: `GOLD_TEAM_REAL_PG17_AFTER_RESTART=PASS`.
- Deleted all synthetic Team records and synthetic Account rows, restarted both Gold services again, and verified seven Team tables empty: `GOLD_TEAM_REAL_PG17_CLEANUP=PASS`.
- UAT runner `deploy/scripts/uat-gold-pro-team.mjs` fails closed if any Team data preexists; it never creates or deletes non-UAT Team data. It reads database URLs via the existing Gold app role's protected runtime environment, not command-line secrets.

## Not claimed
- These checks cover real Pro Team adapter/database durability, **not** a browser-based Pro Team invite acceptance or complete HTTP API flow.
- Other Gold domains, fleet reconnect, public reverse proxy and DNS remain separate acceptance tasks.
- No production database, LXD, domain or service was modified.
