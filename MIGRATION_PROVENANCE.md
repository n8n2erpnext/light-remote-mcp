# Migration provenance

The base is Desktop `eb9a6487c371b072cd5e52cb098fd6873abe3a49`, after comparing component trees and T11 source/physical evidence with Gold `a80d5ebe0644766e7b4c4dfd3ca2d18beff18209` and earlier branches. Gold has no unique executable paths versus this Desktop tree. The choice is based on compatible implementation and regression evidence, not recency alone.

Recovered additions: Project Continuity from `834d498487f97014eb5bfe01606ed1b4bcd0a10f`, separate legacy LM0.2 extension bundle from `6cafb33be6399af6ec41667d4f82be8c9c79b691`, and RC50 missing portability/source paths from `554296649e2580ec36897452ce8042e20a08b4a0`. Conflicting RC50 migration lock was rejected in favor of the current core lock. The machine-readable mapping records decisions and each selected file's original Git blob.

New work: one version manifest, one truth/checkpoint, package endpoint/contract wiring, provenance builds, one CI controller, isolated real DEV bootstrap and source regression phase corrections. Existing authorization checks were retained. Packaging-only tests run against the Windows package tree; the legacy WinForms visual test is explicitly excluded from V4 and remains archived.

Historical project-book/checkpoints/lane instructions and workflow recipes are under `docs/history/pre-reconstruction/` and have no authority over this new workspace. Old source/worktrees were not edited to mirror new documents.

Git archive: `recovery/light-remote-mcp-all-stores-refs.bundle` under the private workspace root. SHA-256 `95a4764f213abb649a2df25f92906918bca79987908edda42b110d7880bed8fe`. Independent restored store: 2,285 refs equal, `git fsck --full` PASS. This preserves old histories without importing their parents into the new development history.

The GoldABV2 LM0.3 bundle already exists in the selected Desktop base and was not replaced by the separate restored legacy extension. Verified build source/digests are explicitly pinned in the JSON. Runtime comparison found matching SQL043 locks, a comment-only preview difference, and older Operator/Wall code missing selected newer snapshot/SSO/scale fixes; old stages were archived rather than blindly promoted.
