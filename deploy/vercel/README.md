# Light Remote MCP — Vercel bridge deployment

This bundle is the thin Vercel edge/bridge. It is **not** the durable Server/Hub by itself. Install the Linux Server/Hub first, publish its MCP gateway through HTTPS, then point this bridge at it.

## Required environment

Set these Vercel Production variables:

```text
VPS_MCP_BASE=https://mcp.example.com
VPS_MCP_URL=https://mcp.example.com/mcp
VPS_MCP_AUDIENCE=https://mcp.example.com
OPERATOR_PUBLIC_KEYS_JSON={...public key set printed by the Linux Server installer...}
```

`VPS_MCP_AUDIENCE` must equal the audience configured on the Linux Server. The server also verifies the Vercel team slug, project name and `production` environment before accepting privileged bridge calls.

`OPERATOR_PUBLIC_KEYS_JSON` contains only the public encryption key set. Never upload the matching private key to Vercel.

## Deploy from this release bundle

```bash
tar -xzf Light-Remote-MCP-Vercel-Bridge-*.tar.gz
cd light-remote-mcp-vercel
npm ci
npx vercel link
npx vercel --prod
```
Before the production deploy, add the variables through the Vercel dashboard or `vercel env add`. Do not commit environment values into this bundle.

The bridge project name and team slug must match the values passed to the Linux Server installer. If you rename the Vercel project later, update the server-side `VERCEL_PROJECT_NAME` and restart the gateway.

## Deploy from GitHub instead

The repository root is also directly deployable. Import/fork `n8n2erpnext/light-remote-mcp` into Vercel, select the repository root, configure the same environment variables, then deploy `main` or the beta tag you intend to test.

The release bundle exists so a self-hosting user can deploy an exact tagged source surface without cloning the whole engineering repository.

## Boundary

The Vercel bridge may disappear or be replaced by a hosted Light Remote Server later. Clients and the Plugin/App contract must not depend on Vercel-specific behavior.
