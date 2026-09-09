# v0.5.1 — Vercel bridge caller-boundary hotfix

Date: 2026-09-09
Status: production v0.5.x history; superseded on v0.6 development branch by removal of the static shared Bearer boundary

## Finding
During soak, an anonymous internet request to the Vercel bridge could open an operator session and execute a harmless proof command. The ARM gateway correctly required Vercel OIDC, but the Vercel function itself did not authenticate its original caller before minting that upstream OIDC identity.

The mistaken assumption was: `Vercel OIDC authenticates the caller`. Correct model: Vercel OIDC authenticates **Vercel -> ARM** only.

## Fix
- New `lib/caller-auth.js` enforces an outer `Authorization: Bearer` boundary.
- Expected secret comes only from `VPS_BRIDGE_CALLER_SECRET`.
- If the secret is absent, shorter than 32 characters, missing from the request, or wrong, the bridge fails closed with `401 bridge_caller_auth_required`.
- The guard runs before any read proxy, session mutation, operator execution, or upstream OIDC acquisition.
- `/api/guide` remains public documentation only.
- ARM keeps its independent Vercel OIDC and encrypted-envelope controls.

## Operational rule
Do not put the bridge caller secret into a URL/query parameter to preserve GET tooling. A client that cannot send the Authorization header must use the private RDC rescue lane until a header-capable authenticated ChatGPT App/Plugin or Vercel Deployment Protection path is active.

## v0.6 supersession
The v0.6 development branch removes `lib/caller-auth.js`, `VPS_BRIDGE_CALLER_SECRET`, and the static `Authorization: Bearer` requirement. This file remains only as an accurate record of the v0.5.1 production hotfix. Public-product authorization is planned at the account/device/ChatGPT permission plane instead of a shared long-lived secret.
