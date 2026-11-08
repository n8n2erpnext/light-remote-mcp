# Isolated DEV environment

This is a disposable integration profile, not production release readiness. `deploy/unified/dev.py` is the executable source of bootstrap configuration. It creates a Docker internal network, new labelled containers/volumes, private random credentials, a fresh marked database and two independent short-lived test certificate authorities. Existing LXD services, host Agent, databases, DNS, trust stores and sessions are unchanged.

The canonical GoldABV2 hostname resolves only inside the private app network. It points to the candidate's TLS transport and actual Plugin, never the old public Lab. No host DB/Redis or public app ports are published. The app has a read-only image, non-root UID, no Docker socket, no Linux capabilities and only its own state mount. Migrator/admin credentials and CA signing keys are never mounted into the long-lived app.

PostgreSQL app role is `lr_gold_app`, without CREATE/ledger writes/migrator membership. Separate `lr_gold_migrator` applies checksum-locked core 001..043 plus `owner-authority.v1`. Guest 044 remains OFF. Redis is password-protected, instance-prefixed and memory-bounded. Images are digest-pinned in `images.lock.json`.

Enabled for DEV: independent Gold, Owner authority, Desktop Owner consent/token/read, A/B V2 account/Wall approval, Desktop Wall SSO operator/issuer and the actual mTLS edge. Feature flags do not bypass passwords, PKCE, Owner checks, origin/CSRF rules, local consent or enrolled-device signatures. Positive live Agent/SSO relay remains a separately reported integration gap until exercised.

Only synthetic `@unified.invalid` fixture accounts are seeded using the actual account registry password hashing/persistence. Reports omit passwords/tokens and explicitly mark physical acceptance false. `.unified/` is private and gitignored; never upload raw fixture state or logs. Certificates expire after seven days; recreate a candidate rather than disabling TLS validation.

The integration actor enrolls a new Agent using its actual CLI and Owner Portal approval, then validates certificate polling, signed heartbeat/connect, a running protected Local Wall and nonempty Desktop device data. The Docker image generates the canonical GoldABV2 package marker from the same embedded JSON. Positive mTLS SSO ticket issuance is proven; signed redemption/browser relay and B-command acceptance are not inferred from it.

Current retained evidence is docs/evidence/deployment-manifest.json at the verified build source. status prints a receipt; inspect resource labels/State for liveness. Disposable test and retained start share a latest pointer, so run test before start in this DEV helper. The private network has no public/host ports; prepare controlled transport before native Windows/new-backend UAT.
