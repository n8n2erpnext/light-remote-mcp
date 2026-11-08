# API integration matrix

Contract version: `light-remote.api.v1`. Runtime header: `X-Light-Remote-API-Version`. Canonical package origins/routes: `config/endpoints.json`. Requests, response purposes, authority and exact flags: `contracts/api.v1.json`.

| UI/native feature | Plugin contract | Operator/backend | Authorization / verification |
|---|---|---|---|
| Owner login | ownerAuthorize -> ownerToken | Portal account verification and live session | Secure Portal cookie, explicit consent, one-use PKCE code, native-only exchange |
| Persistent Owner | ownerRefresh / ownerSession | Redis family + live PG Portal session | Native vault binding; rotation/revocation |
| Logout | ownerLogout | Delete live Owner family | All descendant access/refresh credentials revoked |
| Overview | ownerSnapshot | operatorOwnerSnapshot over Unix socket | Independent READ flag; Owner/account-session checked again |
| Devices / inventory | snapshot page devices | Native device registry | Owner-scoped bounded cursor page |
| AI access / active grants | snapshot page grants | Native A/B grants | Read surface never grants Agent execution |
| Usage | snapshot page usage | Native usage registry | Owner-bound page and retention semantics |
| Activity / jobs | snapshot page jobs | PG job ledger | Coverage/retention markers; no invented full history |
| Sessions | snapshot page sessions | Redis retained session registry | Bounded renewable history, not immutable audit |
| Open Wall SSO | ownerWallTicket | Trusted internal issuer + signed device relay | Separate flags; actual mTLS edge; enrolled-device proof and live family required |
| Wall pending B approval | wallBApprove | Public A/B V2 signed approval -> Operator | Local Owner consent, device signature and B checks remain mandatory |
| Wall Long Memory | wallModulesRead / wallModulesConfigure | Same-device Agent module manager | Committed revision + pending UI state; source regressions retained |
| Native Windows pending approvals | Tauri -> named pipe | C# Agent host -> device API | Local native IPC plus current A/B gates |
| Fleet/account/settings | Existing account/device routes | Accounts, entitlement, fleet registries | Existing cookie/native authority, no DEV bypass |

The contract catalog covers critical V4 routes. Remaining legacy route families still need full machine-readable request/response schemas before an exhaustive OpenAPI claim is appropriate. No mutable cloud endpoint override or credential migration across products was introduced.
