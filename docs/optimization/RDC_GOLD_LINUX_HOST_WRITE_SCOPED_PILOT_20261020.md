# GOLD — Linux sudo + mount namespace scoped host-write pilot
Date: 2026-10-20 | Branch: feature/light-remote-gold-rebuild-20261018 | Status: Gold pilot tested, not general broker.

## Verified RCA
Read full HOMESV incident handoff from /home/ubuntu/handoffs/LIGHT_REMOTE_LINUX_SUDO_MOUNT_NAMESPACE_HANDOFF_2026-10-20.md and repo copy LIGHT_REMOTE_LINUX_SUDO_MOUNT_NAMESPACE_RCA_20261020.md.
HOMESV installed Device Agent: sudo -n id -u returns 0, but ProtectSystem=strict + ReadWritePaths=/home/ubuntu/.config/gpt-operator-agent makes /etc and /usr/local read-only inside service mount namespace; exec and PTY inherit it. This is separate from G1 random upstream pre-dispatch refusals. No HOMESV service, firewall, or product production environment changed here.

## Implemented on Gold branch (opt-in, default unchanged)
- device-agent/linux-service-policy.mjs: validateLinuxHostWritePaths() and CLI field hostWritePaths. Accept at most 4 unique absolute existing canonical directories, only under /etc/, /usr/local/, /var/lib/, /opt/. Require directory and every ancestor to be root-owned and not group/other writable. Refuse symlinks, traversal, unexpected tokens, root/broad mount points, user-owned directories. This is installer-time validation, NOT an arbitrary unprivileged process allowlist.
- client/linux/install.sh AND device-agent/install-linux-service.sh: support repeated --host-write-path DIR, require --acknowledge-host-write-risk to change scopes. Installed service keeps ProtectSystem=strict and grants only approved explicit directories as additions to its existing ReadWritePaths state directory. No owner paths specified => existing default sandbox remains in place.
- Root-owned 0600 persistent manifest /etc/gpt-operator-agent/host-write-paths.list stores opt-in for subsequent installer updates/reinstalls; validation repeats every time. --clear-host-write-paths --acknowledge-host-write-risk clears the manifest and restores state-only ReadWritePaths on reinstall. On changes the installer updates systemd unit and restarts using existing regular setup flow, not an Agent PTY escape.
- Existing local Wall sudo-on-demand explanation now says UID0 does NOT override RO mount namespace; host write needs separately approved installer paths. Ordinary device/session server sudo authorizations still apply; no automatic elevation.
- Updated selftest-device-agent-service.mjs and selftest-v09-linux-service-policy.mjs. Added selftest-gold-linux-host-write-policy.mjs for negative path validation & persistence markers. Linux x64+arm64 CI workflow opted into Gold branch for isolated Actions artifacts and invokes these selftests. GitHub release publication/update channels NOT modified.
- Added deploy/scripts/uat-gold-linux-host-write-mount.sh to reproduce real systemd canary inside Gold isolated LXD ONLY. It creates then removes harmless test directories/files; does not install a product Agent or modify running Gold service unit.

## Actual systemd mount test — Gold LXD ARM64
Container light-remote-gold-uat RUNNING; systemd-run available. Two transient systemd services tested under User=root in container (UID0 chosen to isolate mount permissions from Unix DAC):
- Negative: ProtectSystem=strict; no ReadWritePaths for fixture => touch root-owned fixture path rejected, /etc mount ro. PASS.
- Positive: ProtectSystem=strict; ReadWritePaths=/var/lib/lr-gold-host-write-allowed => touch in allowlist succeeds, sibling /var/lib/lr-gold-host-write-denied fails, /etc remains ro. PASS.
- Gold Wall and Gold Operator remained active, test files cleaned. UID0 in isolated container models mount namespace ONLY: this is not acceptance of passwordless sudo from enrolled nonroot Linux client, nor an independent host-operation broker.

## Security and scope limits (MANDATORY)
- **This is a bounded opt-in mount exception, not the final per-operation root host-maintenance broker.** It does not introduce new host-system-write capability nor independent local consent for every host operation. Owner approval happens at installer configuration time and normal sudo-on-demand/session policy still controls later commands. A compromised service account that is already authorized to sudo could mutate every file under a selected directory. Therefore avoid broad directory opt-ins outside expendable Gold/canary until a separately authorized per-operation broker has been designed and reviewed.
- The opt-in may be used only for existing root-owned directories; no implicit creation of system directories. Removing an allowlist entry requires unit regeneration/restart using --clear-host-write-paths. No ReadWritePaths=/, no ProtectSystem=off, no nsenter/remount privilege bypass.
- Gold tests have not yet proven command-level per-operation authorization or package installation, real HOMESV upgrade, Windows/macOS applicability, or cross-version updater restoring old manifest. Keep this work OPEN as staged pilot, G2 IN PROGRESS.

## Evidence, checks, and next steps
- node selftest-gold-linux-host-write-policy.mjs PASS; selftest-device-agent-service.mjs PASS; selftest-v09-linux-service-policy.mjs PASS; bash -n both Linux installers PASS; git diff --check PASS.
- Gold LXD: GOLD_MOUNT_DEFAULT_RO_PASS, GOLD_MOUNT_ALLOWLIST_WRITE_AND_OTHER_DENIED_PASS, GOLD_SYSTEMD_REAL_MOUNT_ACCEPTANCE_PASS.
- Check CI artifact builds on exact Gold source commit before publishing the build result. Review future true host-maintenance broker contract (independent owner + server capability authorization, bounded filesystem/service scopes, auditable request ID, rollback and rejection reason HOST_MOUNT_READ_ONLY_BY_AGENT_SANDBOX). Do not claim this pilot closes the entire RCA or change HOMESV before owner approval.
