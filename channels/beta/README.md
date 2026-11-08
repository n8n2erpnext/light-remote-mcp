# Beta update channel

`client-update.json` and `client-update.json.sig` are the signed control pointer consumed by Windows, macOS, and Linux updaters. Binary artifacts are served from immutable release storage; the beta default is GitHub Releases.

Release flow: build all required platforms → create prerelease assets → generate `client-update-unsigned.json` from those exact bytes → sign the exact manifest with the owner release-authority key → run `deploy/scripts/promote-client-update-channel.mjs` → commit both signed channel files together.

Promotion is fail-closed. It requires the manifest version to equal the current `VERSION`, rejects rollback and same-version content changes, verifies the detached signature, checks all required platforms and HTTPS URLs, and by default downloads every remote artifact to verify size and SHA-256 before applying the channel pointer.

The private signing key is release-authority material. The current owner-controlled deployment retains it on ARM with restrictive permissions; it must not be copied into GitHub Actions, Vercel, release assets, or client packages. Clients contain only `client/update-public.pem`.

`--skip-remote-verify` exists for isolated tests and controlled dry-runs only; production promotion should not use it. Stable distribution must use a separate stable channel/policy rather than reusing beta.
