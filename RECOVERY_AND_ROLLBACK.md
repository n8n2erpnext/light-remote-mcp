# Recovery and rollback

Private recovery root: `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/recovery`. Combined bundle `light-remote-mcp-all-stores-refs.bundle` SHA-256 `95a4764f213abb649a2df25f92906918bca79987908edda42b110d7880bed8fe`, 2,285 refs. `restore-all-stores-proof.git` was independently populated and passed full fsck/ref equality. Three original Git admin stores, dirty source patches and selected unknown source are preserved separately.

Restore into a NEW path: `git clone --mirror <bundle> <new-recovery.git>`; `git -C <new-recovery.git> fsck --full`; compare refs with `inventory/RECOVERY_ALL_STORES_VERIFICATION.json`. Recovered namespaces distinguish VPS, GitHub, extra stores, worktree heads and reflogs. Never test restore over an old live worktree.

Release recovery: 22 releases / 421 asset records / 372 deduplicated objects, 14,440,600,519 bytes; all stored objects verified against size and GitHub SHA-256. Important accepted Windows CI ZIP also preserved (see regression baseline). Release descriptions/asset metadata, accessible GitHub run records and source configuration are archived. Disposable CI binaries beyond the selected known-good artifact are not all downloaded; metadata is preserved. GitHub encrypted secret values are not exportable.

Old runtime remains live throughout reconstruction. DEV stop validates each container/network/volume ownership label before touching it and only removes its own synthetic resources. Raw candidate state remains private for diagnosis. No host/LXD cleanup or Docker prune is part of this procedure.

For later migration: retain old runtime folders and a pre-cutover database snapshot. Run new code from a new clone/new directory. Move traffic only after acceptance; rollback selects old runtime/traffic without copying new source over old paths. Data migration and traffic cutover require a concrete later plan and Owner approval where disruptive. Do not delete old runtime/archive until explicitly approved.

Completed repository conversion: old GitHub ID1361698660 is read-only at https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108; official name now ID1450214328. Fresh pre-reset mirror bundle under conversion-20261108/github-before-reset.bundle has SHA-256 6d7c110b56704a66398670b168cefe4a4c1d0fbf7347f4ea915cb613e70648d4; independent restore125 refs/full fsck PASS. Private admin metadata ZIP SHA-256 082d84bc3cf419941988095ea8aa5cf54a29f78a5b51aaf796818a7c02ac8ee8. Old worktree remotes were not rewritten; never use them to push/fetch new unrelated official history.
