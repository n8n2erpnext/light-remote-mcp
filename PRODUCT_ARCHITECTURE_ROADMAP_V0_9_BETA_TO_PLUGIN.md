# Light Remote MCP — Product Architecture Roadmap

Updated: 2026-09-11
Status: architecture lock for v0.9 beta and the path to a public ChatGPT Plugin/App
License: Apache-2.0 for Light Remote MCP source; third-party notices remain separate.

## Product boundary
Light Remote MCP is a remote execution/control plane, not an SSH wrapper and not a Vercel-specific product.

The long-term logical path is:

`Client <-> Light Remote Server <-> Light Remote Plugin/App <-> ChatGPT`

Results flow in the reverse direction. Clients keep outbound authenticated connections to the Server; ChatGPT never needs direct network access to a user's device.

Vercel is a deployment/bridge target, not the authority model. The same Server contract must remain deployable on a Linux VPS/self-hosted environment and later on the hosted service operated by the project.

## Locked authority model
Tool descriptions teach an Agent what it may request; they are never the security boundary.

`ChatGPT intent -> Plugin/App schema -> account authorization -> Server policy -> signed device policy -> platform capability inference -> local executor`

No layer may silently widen the authority granted by the layer below it. A caller cannot hide an inferred capability by omitting it from metadata.

Explicit target binding, no silent device fallback, durable sessions/jobs, idempotent command delivery, auditable mutations, and fail-closed policy remain release invariants.
## Plugin/App contract
The Light Remote Plugin/App must be thin and self-describing. A newly connected Agent should be able to discover the operating contract and the tools without relying on conversation history.

Target tool families are intentionally explicit: device discovery/capabilities, session open/resume/close, durable exec, job status, bounded output reads, policy inspection, and narrowly governed elevation requests.

The machine-readable contract should state at minimum: `role=remote_execution_control_plane`, `sessionModel=durable`, `targeting=explicit`, `silentFallback=false`, `privilegeModel=capability_based`, `defaultPrivilege=normal-user`, `audit=true`, and `devicePolicyAuthoritative=true`.

Plugin/App code should contain minimal business authority. Account/device authorization, routing, durable job state, policy, audit and updates belong to the Server.

Official Plugin Directory publication is a later distribution milestone. For the current owner workflow on ChatGPT Plus, full write-capable custom MCP is not available, so the operational control path is the protected Vercel bridge used through the installed `@Vercel` connector. Direct MCP/OAuth remains a Business/Enterprise/Edu test/future-publication lane, not the Plus continuity lane.

## Account and distribution target
A future distribution website owns signup/login, downloads, documentation, Terms/Privacy, account/device management and optional billing. It is not part of the critical job execution path.

The Server owns account tokens, device certificates, device registry, policy, sessions/jobs, audit, update metadata and the MCP/Plugin endpoint. Marketing/download availability must not determine whether an already-running job survives.

Hosted and self-hosted deployments must share the same protocol and device identity model so moving from Vercel/reference infrastructure to a project-hosted Server does not require re-architecting clients.

## Desktop client lock
Windows and future Linux Desktop clients run primarily as the signed-in user. Admin/root is a capability/elevation event, not the permanent identity of the agent.

Target onboarding: download client -> sign in to the Light Remote account -> review Terms/Privacy -> enroll the device -> review/grant capability profile -> start the outbound connection. Privileged capabilities require explicit grant and may still require action-time confirmation.
Desktop Wall defaults to localhost only. A native shell may embed or open the local Wall, but the Wall backend should remain independently bindable and should not require public exposure.

Linux Desktop GUI is a roadmap item; the v0.9 beta Linux package remains the systemd/CLI agent path and must not be documented as if the native desktop GUI already exists.

## Linux Server lock
Linux Server is the first self-hosted Server/Hub distribution target. Beta supports an automated installer/script path; apt/rpm repositories are a later stable distribution improvement.

Installer choices must include the Wall bind policy. Default is localhost. A user may explicitly choose a VPN/LAN/custom bind; public binding is never implicit. The installer must print the effective bind and security assumptions before enabling services.

The Server package must preserve the existing split between an unprivileged gateway and the host executor, externalize signing/private keys, keep durable state outside the package directory, and remain upgradeable without destroying enrollment/audit state.

## Deployment adapters
`deploy/vercel` represents the public/serverless bridge package. `deploy/server-linux` represents the Linux self-hosted Server/Hub package. Future hosted infrastructure may replace the reference Vercel/ARM topology without changing the Plugin/App or Client contract.

Beta quick-start is intentionally explicit about topology: Vercel alone is not the durable Hub. A self-hosted beta operator needs the Vercel bridge plus a Linux Server/Hub, then one or more clients. A future hosted Light Remote Server may collapse that setup for end users.

## v0.9 beta technical freeze
The following are frozen unless a release-blocking defect is found: signed device identity, signed policy revision, outbound leaf poll/result protocol, target-bound sessions, session ownership, command lease/redelivery, idempotent result receipts, capability inference, Linux signed updater/rollback, Windows signed updater/rollback, Wall structured policy/update mutations, and third-party runtime notice packaging.

Do not add new privileged capability classes during the beta cut. Changes to the above require a regression addition plus re-running the full release gate.
## RDC replacement continuity gate
RDC is rescue-only and must not remain a product dependency. The **current ChatGPT Plus continuity lane is Vercel-only**:

`ChatGPT Plus -> @Vercel -> Vercel-authenticated protected preview -> api/operator?via=plus -> preview-scoped Vercel OIDC -> ARM Hub -> explicit ARM/AMD/Windows target`.

Before RDC disappears, a fresh Plus chat using only `@Vercel` must independently pass device/fleet discovery, durable session open/resume/close, encrypted exec/job/output, filesystem mutation, Git/build-test, process/network/service reads where supported, and policy-authorized maintenance actions. The Plus bridge accepts GET at the ChatGPT-facing edge because the current Vercel connector fetch surface cannot attach arbitrary project headers or POST bodies; mutations remain idempotent through stable operation IDs and are executed as internal POSTs after Vercel Authentication and preview-scoped OIDC verification. Public production access is not an acceptable substitute for Vercel Authentication.

Dogfooding is now a merge/release invariant: a feature that makes the project impossible to operate through the Plus -> Vercel lane is a release-blocking regression. Direct MCP OAuth dogfood remains a secondary protocol test, not the owner continuity gate.

Self-host owner OAuth may remain in v0.9 for eligible Business/Enterprise/Edu testing and future Plugin/App publication. Hosted multi-user account OAuth remains post-beta.

## Post-beta roadmap
1. Hosted account plane: distribution-site accounts, account-scoped device ownership/revocation, multi-user OAuth/SSO, and billing/plan policy where applicable.
2. Plugin/App product surface: self-describing tool catalog and operating contract; publish privately first, then submit for Plugin Directory review when eligible.
3. Distribution web: account onboarding, downloads, device management, Terms/Privacy and release channels.
4. Linux Desktop native UX with the same localhost-Wall and normal-user privilege model as Windows.
5. Hosted Server: operate the same Server contract as the self-hosted Linux package; remove dependency on the reference owner's ARM/Vercel infrastructure for public users.
6. Package repositories: apt first, then rpm if demand warrants it; signed repository metadata and explicit release channels.
7. macOS: defer until Windows/Linux distribution and signing/update operations are stable.

## OpenAI distribution reality for this beta
As of this roadmap date, full MCP write/modify actions are available to Business and Enterprise/Edu, not ChatGPT Plus. The owner currently uses Plus, and the project is not yet available as a reviewed Plugin/App in the ChatGPT Plugin Directory. Therefore Plus operation is intentionally routed through `@Vercel` and the protected Vercel bridge.

The README must distinguish four states: self-host installation is available; Plus control currently requires the protected Vercel bridge; direct write-capable MCP testing requires an eligible workspace; Plugin Directory availability is future and only after OpenAI review/approval.

## Release progression
`v0.9.0-beta.1` is the first public beta candidate for the frozen execution/control-plane architecture. Beta promotion requires Apache-2.0 root licensing, final full regression (currently 39/39), package CI for Windows/Linux, server deployment bundles, live Vercel + ARM + AMD + Windows version proof, and no release-blocking security regression.

Stable `v0.9.0` is not implied by the beta tag. Stable requires beta soak plus any account/plugin decisions explicitly scheduled for that release.