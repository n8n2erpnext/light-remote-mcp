# GoldABV2 Wall PTY R3 Live Deployment — 2026-11-02

## Scope and commits
- Branch feat/gold-single-owner-transfer-20261101.
- Feature source 21c473883e0a807bb6240d937022a10bcf433651: self-hosted xterm.js 6.0 + FitAddon 0.11, ANSI/VT PTY screen, auto-select running terminal, 500ms incremental output, full-width feature pages and redundant return-link removal.
- Corrective source fb005567a5daca9203ccb81219384bc31368a0df: same-origin CSP script/style allowance, desktop-wide terminal container CSS, stronger six-page HTTP CSP test.
- GitHub latest Gold Source Gate 41439609955: 4/4 PASS. Documentation integrity 41439610106 PASS.
- Previous R3 gate for feature source 41439044025 also PASS.

## Isolated runtime
- VPS-ARM LXD GoldABV2 Lab light-remote-abv2-lab-20261101.
- Previous live R2: /opt/light-remote-abv2-lab/source-2856faf9-wall-r2-STAGED.
- First R3 stage: /opt/light-remote-abv2-lab/source-21c47388-wall-r3-STAGED.
- Final active runtime: /opt/light-remote-abv2-lab/source-fb005567-wall-r3-final-STAGED.
- URL http://100.94.184.141:15591/
- First R3 snapshot: pre-goldabv2-wall-pty-r3-20261102.
- Final CSP snapshot: pre-goldabv2-wall-pty-csp-20261102.
- Previous Wall drop-in backups:
  /var/backups/light-remote-goldabv2-wall-before-pty-r3-20261102.conf
  /var/backups/light-remote-goldabv2-wall-before-pty-csp-20261102.conf
- Only light-remote-gold-wall.service restarted, MainPID 966203, active. Operator/Plugin/Process Supervisor unchanged.

## Runtime acceptance after final cutover
- All 4/4 services active.
- Local and public /login HTTP 200, HTTPS goldabv2 /healthz HTTP 200.
- Active device A/B grants before first R3 rollout 2, after final cutover 2. No revoke or close operations.
- Same-origin vendor assets HTTP 200: xterm.js 488663 bytes, xterm.css 7112 bytes, addon-fit.js 1521 bytes.
- Browser CSP on real HTTP GET: script-src 'self' 'unsafe-inline', style-src 'self' 'unsafe-inline'; frame-ancestors 'none' retained; no external CDN.
- All six feature page route and PTY source regressions PASS under runtime user gold-uat.
- PTY API owner auth and bounded output tests PASS, no grant or PTY input API added.
- No recent Wall systemd error entries after final restart.
- No real Chrome/headless PTY visual measurement available on VPS-ARM. Owner screenshot needed to finish visual acceptance of terminal rendering, drag/resize and full-width pages. Do not claim browser animation/latency measurement was performed.

## Root causes/fixes
- PTY list awaited user selection and only fetched output after click: now automatic nearest running terminal selection.
- 1500ms slow output polling: 500ms, 3500ms list resync, revision and busy guards.
- Previous ptyPlain removed VT/ANSI/CR and rendered a pre block: now xterm.js processes full terminal text with 3000 line scrollback, read-only.
- Local xterm vendor directory initially 0700 root after staging caused 404 under gold-uat; corrected stage directory traversal to 0755, static assets to 0644.
- Browser CSP blocked same-origin external JS/CSS despite asset HTTP 200: narrow same-origin CSP adjustment and six-route test.
- Duplicate content return links and fixed 640-980px centered wrappers: now sidebar-only Wall navigation with flexible width consistent with Codex.

## Rollback
- Restore final *abv2lab.conf in /etc/systemd/system/light-remote-gold-wall.service.d/ from /var/backups/light-remote-goldabv2-wall-before-pty-r3-20261102.conf to return directly to R2, OR from before-pty-csp to return to first R3. Use short temporary filename in same directory + atomic rename. Run systemctl daemon-reload, restart ONLY light-remote-gold-wall.service, confirm previous WorkingDirectory and 4/4 active.
- LXD snapshots last resort; full restore may rewind PG/Redis. Never reset or close grants just for UI rollback.
- No main Gold UAT or production deployment.
