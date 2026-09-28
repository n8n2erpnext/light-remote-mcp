# Light Remote repository lanes

This repository has two canonical product lanes. They share the same Light Remote core, but only V / Primary is the development authority.

| Lane | Canonical branch | Role | Active transport |
| --- | --- | --- | --- |
| **V / Primary** | main | Production and default development authority | Vercel bridge |
| **Reviewer / Direct** | reviewer/openai | OpenAI submission/reviewer runtime | Direct MCP / plugin server |

## Development rule

Core changes start on main. Device runtime, operator host, policy, session/job model, filesystem/process/terminal/SCP, update logic and shared security behavior are developed and tested on V / Primary first.

Reviewer is a downstream lane:

1. sync the current tested main;
2. keep only the reviewer-specific transport/deployment overlay;
3. run reviewer acceptance tests;
4. never merge reviewer-only transport assumptions back into main unless the behavior is first extracted into shared core.

## V / Primary - main

Primary installed path:

ChatGPT -> @Vercel -> Vercel bridge -> Linux Hub -> exact device/session

Platform-specific source lives in api/ and deploy/vercel/.

## Reviewer / Direct - reviewer/openai

Reviewer-facing path:

OpenAI reviewer -> Direct MCP/plugin server -> reviewer fixtures/runtime

Reviewer overlay may contain plugin-server/, plugin.json, mcp.json, skills/, deploy/reviewer/ and reviewer documentation.

## Retired: Netlify backup lane

The former Netlify backup lane was retired on 2026-09-28. Its Git branches, ARM runtime, state, systemd units and active local listeners were removed. It is not a deployment authority and must not be recreated implicitly from primary builds.

See docs/operations/RETIRED_NETLIFY_2026-09-28.md for the reserved ports/domain and historical Git heads.

## Machine-readable identity

Every canonical branch contains .light-remote-lane.json. deploy/scripts/selftest-v11-repo-lane.mjs validates required and forbidden overlay paths so a retired transport cannot silently leak into a canonical lane.
