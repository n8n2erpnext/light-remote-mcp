# GPT VPS Bridge

Minimal read-only Vercel bridge used to prove the path:

`ChatGPT → Vercel → VPS ARM MCP → Vercel → ChatGPT`

## Endpoints

- `GET /api/ping` → calls MCP tool `ping`
- `GET /api/vps-identity` → calls MCP tool `vps_identity`

The upstream MCP endpoint defaults to:

`https://lightbi.app/remote-mcp/mcp`

Override with `VPS_MCP_URL` on Vercel if needed.

## Security

This POC intentionally exposes only harmless read-only tools. Do not add filesystem, shell, Docker, write, or mutation capabilities until authentication, replay protection, capability scoping, and audit controls are in place.
