# Retired Netlify backup lane — 2026-09-28

Status: retired. Do not start, package, deploy, or recreate this lane as part of stable/Core releases.

## Former external project
- Netlify project: light-remote
- Site ID: 99ed0447-33bb-48dd-9131-8882ac1c0da0
- Default Netlify URL: http://light-remote.netlify.app
- Former hub/custom domain: https://nmcp.dashboard.thaiduy.store

The external Netlify project/domain binding is intentionally left untouched during Core standardization. Stable/Core no longer depends on it.

## Reserved former ARM ports
Do not reallocate these until the domain/routing is intentionally repurposed:
- 5493 — former Netlify backup Local Wall
- 5494 — former Netlify backup Fleet Wall

## Removed ARM runtime
- light-remote-n-host.service
- light-remote-n-wall.service
- /opt/light-remote-n
- /var/lib/light-remote-n
- /etc/light-remote-n
- /var/log/light-remote-n

## Retired Git heads
- backup/netlify — f5f87fd387658dded9367eab20f0d3c187fe321c
- netlify-backup — b4248acf9b56d9d4561aaed2c0d87d9cd6edf9eb
- netlify-main-additive — 4a92ff2f278b76befcc298bb0c03b44beec7d917
- netlify-prod — 11a67fbeb938b3d327eb05cc44fa5ce6dab82ea6

The associated worktrees and remote Netlify branches were removed on 2026-09-28.
