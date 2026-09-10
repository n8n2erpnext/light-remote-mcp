# Beta update channel

`client-update.json` and `client-update.json.sig` are generated only after a beta release's client artifacts exist and are hash-verified.

The manifest is signed off-CI with the external Light Remote MCP update signing key. Clients contain only the public verification key. The beta channel may point to prerelease assets; stable clients use a separate stable channel/release policy.
