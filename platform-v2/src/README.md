# Future backend layout (ESM .mjs only)

Maintain all existing public contracts and URLs. New modules are **opt-in and staging-only**; do not splice these into production imports.

- `storage/postgres.mjs`: typed-with-JSDoc transaction/repository boundary for account/usage/outbox; parameterized SQL only; checks non-superuser, exact UAT database on startup
- `storage/redis.mjs`: namespaced ephemeral caching with TTL, no billing/entitlement authority

Gradual production-compatible domain split **inside existing Node.js ESM** (no framework rewrite required):
```
services/account/{routes,service,repository,policy}.mjs
services/device/{routes,service,repository,policy}.mjs
services/team/{routes,service,repository,policy}.mjs
services/billing/{routes,service,repository,policy}.mjs
services/operations/{routes,service,repository,policy}.mjs
shared/{config,logger,errors,events,security}.mjs
infra/{postgres,redis,operator-protocol}.mjs
```

API handlers delegate to domain services; services call repository interfaces; adapters own connection pools. On any unreconciled migration error, keep legacy data authoritative and deny new write path. Never run two authoritative writers during cutover.
