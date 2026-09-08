# GPT VPS Bridge

Private bridge for the owner's VPS ARM:

`ChatGPT -> @Vercel -> Vercel Function -> mcp.dashboard.thaiduy.store -> VPS ARM`

## Start here for a new AI session

Fetch:
`https://gpt-vps-bridge.vercel.app/api/guide`

The guide is deliberately non-secret and exists so another ChatGPT session/account with access to @Vercel can rediscover how to use this bridge without relying on chat memory.

Repository guide:
`AI_BRIDGE_GUIDE.md`

## Current endpoints

- `GET /api/ping`
- `GET /api/vps-identity`
- `GET /api/system-status`
- `GET /api/workspace-roots`
- `GET /api/fs-list`
- `GET /api/fs-read`
- `GET /api/fs-search`
- `GET /api/git-status`
- `GET /api/git-diff`
- `GET /api/guide`

## Design direction

The bridge should minimize ChatGPT tool-call overhead. Related operations may be grouped into one server-side batch instead of forcing one remote tool call per shell fragment.

The public MCP gateway stays unprivileged. Privileged host operations, when enabled, belong behind a separate authenticated host executor running as `ubuntu` so normal configuration, testing, Docker/LXD work, and `sudo` remain possible without mounting the Docker socket into the public gateway container.

## Security

- VPS tool execution validates Vercel OIDC for the expected team/project/environment.
- Keep secrets out of URL query strings and public logs.
- The activity wall is observability-only.
- Disk-side operational logs should retain enough detail to reconstruct work after a ChatGPT context rollover, with bounded rotation on the VPS.
