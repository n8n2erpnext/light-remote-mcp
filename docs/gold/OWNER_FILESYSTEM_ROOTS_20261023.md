# Gold — owner-configurable filesystem allowed roots (2026-10-23)

**Scope:** Only filesystem permissions in Gold. Do not modify the 24-hour A/B access grant, Device Connection lease, account authentication, or session limits. Those limits are intentional security and capacity controls.

## Why
Production rc.47 user `kgsz3000@gmail.com` reported a Windows device with `filesystem` in effective capabilities, but structured `list_files/stat_path E:\STREC` failed with `filesystem_path_outside_allowed_roots`. Logs confirm the denial reached the device. The Full Access profile enabled the capability but did **not** configure device-local filesystem roots. Running the service as Administrator would not bypass this independent policy gate.

## Gold behavior implemented
- Local Wall `/permissions` has a separate **Filesystem access locations** editor.
- Owner enters **Read locations** and **Write locations**, absolute paths one per line, including a Windows folder or drive root. Write locations must be contained by a Read location.
- The owner-authenticated local endpoint `POST /api/filesystem-roots` has CSRF enforcement; requests do not travel to the public cloud to authorize local filesystem paths.
- Validated roots persist in the existing device-local `state.policy.filesystemRoots` using the atomic state writer. They are active for subsequent commands **without reconnect/reinstall**.
- Existing installations retain their prior environment-based filesystem defaults until the owner explicitly saves access locations. Empty lists mean deny all, NOT fall back to unrestricted access.
- All structured filesystem commands, native search, and SCP download/upload refer to the owner policy. Pending SCP transfers re-check scope on chunk/commit; ongoing search handles and cached results are invalidated on change.
- The signed server-approved `filesystem` capability is still required; choosing roots does not grant capability by itself, bypass OS ACLs, grant Administrator elevation, or escape symlink realpath checks.
- `Full Access` selects capabilities only: drive-wide filesystem access still requires separate explicit owner selection.

## Acceptance evidence and limitations
- `node deploy/scripts/selftest-gold-owner-filesystem-roots.mjs`: PASS using real Linux filesystem fixtures and Windows path-normalization simulation, Local Wall authenticated/CSRF route, browser script syntax check and SCP scope revocation.
- NO live Windows Gold client with an E: drive was connected or modified; this still needs Windows 10/11 smoke verification before shipping.
- No rollout to production rc.47, to the customer's computer, or to running Gold UAT was made in this patch.
- A/B maximum authorization lifetime remains exactly 24 hours.

## Next release checks
1. Build Gold Windows package and open `http://127.0.0.1:5491/permissions`.
2. Confirm Full Access alone continues to honor configured allowed roots; append `E:\STREC` under Read and optionally Write, then save separately.
3. Verify structured `list_files` and `stat_path` read E:\STREC, write blocked when Write omits E:, SCP and search follow the same rules.
4. Remove E: root and verify all new operations are blocked, including existing SCP transfers and searches. Restart Agent: persisted roots must survive.
5. Verify no permission change grants filesystem capability if server policy or local capability denies it.


## Owner-selected OS volumes / A-B lease visibility (Gold follow-up, 2026-10-23)

- Windows Local Wall enumerates fixed, removable, mapped and optical logical drive letters through device-local PowerShell (Get-CimInstance Win32_LogicalDisk) with bounded fallback. Read/Write checkboxes are shown per detected drive; additional absolute subdirectories are allowed.
- Windows initial policy defaults to C:\ for read/write (plus existing service home/temp directories) until the owner customizes roots. D:\ / E:\ remain owner opt-in. NTFS/UAC permissions continue to apply.
- macOS Local Wall offers Home and volumes under /Volumes; Linux offers Home and applicable mounted filesystems (mountinfo). No automatic root-wide Linux/macOS grant.
- Inventory endpoint GET /api/filesystem-volumes requires Local Wall authentication, and does not sync volume labels to cloud.
- Local Wall displays an Agent A/B access countdown, calculated from server-sourced activeGrant.absoluteExpiresAt and expiresAt; A code expiration and cloud connection timers remain separate.
- 24-hour A/B maximum lifetime remains UNCHANGED; owner must reapprove after expiry. No stealth extension.
- Windows 'Administrator (Windows UAC)' remains an owner-controlled, remembered capability flag, not a mechanism for silent elevation. The installer uses PrivilegesRequired=lowest and there is no broker that could safely cache one-time UAC approval. Implementing a one-time privileged Windows broker/service requires a separate security-reviewed change. Do NOT promise it exists.
- Verify Windows 10/11 with real E: volume, Windows UAC behavior, power users, network drive mapping, and restart persistence before publishing binaries.
