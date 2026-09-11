# Light Remote MCP — Vercel bridge deployment

This bundle is the thin Vercel edge/bridge. It is **not** the durable Server/Hub by itself. Install the Linux Server/Hub first, publish its MCP gateway through HTTPS, then point this bridge at it.

## Required environment

Set these Vercel variables for **Production and Preview** (the current ChatGPT Plus bridge runs through a protected Preview deployment):

```text
VPS_MCP_BASE=https://mcp.example.com
VPS_MCP_URL=https://mcp.example.com/mcp
VPS_MCP_AUDIENCE=https://mcp.example.com
OPERATOR_PUBLIC_KEYS_JSON={...public key set printed by the Linux Server installer...}
```

`VPS_MCP_AUDIENCE` must equal the audience configured on the Linux Server. The server verifies the Vercel team slug, project name and environment. Legacy/reference operator calls remain `production` scoped; the ChatGPT Plus bridge is separately pinned to `preview` and is intended to sit behind Vercel Authentication.

`OPERATOR_PUBLIC_KEYS_JSON` contains only the public encryption key set. Never upload the matching private key to Vercel.

## Deploy from this release bundle

```bash
tar -xzf Light-Remote-MCP-Vercel-Bridge-*.tar.gz
cd light-remote-mcp-vercel
npm ci
npx vercel link
npx vercel --prod
```
Before deploying, add the variables through the Vercel dashboard or `vercel env add` for both Preview and Production. Do not commit environment values into this bundle. For ChatGPT Plus control, keep the preview protected with Vercel Authentication and call `/api/operator?via=plus` through `@Vercel`; the endpoint rejects production deployment traffic by design.

The bridge project name and team slug must match the values passed to the Linux Server installer. If you rename the Vercel project later, update the server-side `VERCEL_PROJECT_NAME` and restart the gateway.

## Deploy from GitHub instead

The repository root is also directly deployable. Import/fork `n8n2erpnext/light-remote-mcp` into Vercel, select the repository root, configure the same environment variables, then deploy `main` or the beta tag you intend to test.

The release bundle exists so a self-hosting user can deploy an exact tagged source surface without cloning the whole engineering repository.

## Boundary

For the current ChatGPT Plus owner workflow, the Vercel bridge is a required compatibility layer because Plus cannot use the write-capable custom MCP lane. It may disappear only after a supported Light Remote Plugin/App or another first-party write-capable integration is available. Clients and the core Server/device authority model must still remain portable.
