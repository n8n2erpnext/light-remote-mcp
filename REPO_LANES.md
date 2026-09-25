# Light Remote repository lanes

This repository has three canonical product lanes. They share the same Light Remote core, but only one lane is the development authority.

| Lane | Canonical branch | Role | Active transport |
| --- | --- | --- | --- |
| **V / Primary** | `main` | Production and default development authority | Vercel bridge |
| **Reviewer / Direct** | `reviewer/openai` | OpenAI submission/reviewer runtime | Direct MCP / plugin server |
| **N / Backup** | `backup/netlify` | Disaster-recovery bridge | Netlify |

## Development rule

**Core changes start on `main`.** Device runtime, operator host, policy, session/job model, filesystem/process/terminal/SCP, update logic and shared security behavior are developed and tested on V / Primary first.

Reviewer and N are downstream lanes:

1. sync the current tested `main`;
2. keep only the lane-specific transport/deployment overlay;
3. run that lane's own acceptance tests;
4. never merge Reviewer- or Netlify-only transport assumptions back into `main` unless the behavior is first extracted into shared core.

This prevents three independent copies of the same runtime from drifting.

## V / Primary - `main`

This is the installed production path used by ChatGPT Plus:

`ChatGPT -> @Vercel -> Vercel bridge -> Linux Hub -> exact device/session`

Platform-specific source lives in `api/` and `deploy/vercel/`. The primary branch intentionally does **not** contain the Netlify implementation or Reviewer plugin overlay.

## Reviewer / Direct - `reviewer/openai`

This is the OpenAI submission lane. Its reviewer-facing path is:

`OpenAI reviewer -> Direct MCP/plugin server -> reviewer fixtures/runtime`

Its overlay is expected to contain `plugin-server/`, `plugin.json`, `mcp.json`, `skills/`, `deploy/reviewer/` and reviewer documentation. The reviewer path must not require the Vercel connector.

## N / Backup - `backup/netlify`

This is the Netlify backup lane. It inherits tested core behavior from `main` and adds only the N bridge/runtime adapter. Netlify is not the development authority and should not introduce a second copy of core behavior.

## Branches that are no longer canonical

Historical branches such as `reviewer/openai-full-product`, `netlify-prod`, `netlify-backup`, `netlify-main-additive`, `codex/*`, `fix/*` and `hotfix/*` are implementation history or staging branches. Do not use them as the source of truth for a new deployment after the canonical lanes above are established.

## Machine-readable identity

Every canonical branch contains `.light-remote-lane.json`. `deploy/scripts/selftest-v11-repo-lane.mjs` validates required and forbidden overlay paths so a transport lane cannot silently leak into another lane.
