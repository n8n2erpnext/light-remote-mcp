# Desktop user experience reconstruction

Owner feedback, 2026-11-09: the installed internal dev.3 Desktop works, but every screen reads like an engineering console. The B approval button overlaps its input. This confirms working installed UI only, not complete physical acceptance of every feature or B approval.

## Scope and presentation rules

Apply to all nine Desktop routes, login, linking, confirmation dialogs and the browser Desktop consent page. Preserve existing native Owner/account/device authority, async fences, CAS, grants, credentials, technical route IDs and one-primary-executable packaging. No new API authority or invented telemetry.

- Use task-oriented headings, concise explanations and one clear primary action in each section. Present recognizable device/Agent names, friendly status badges and readable dates; expose opaque IDs, raw event names, transport/persistence/revision diagnostics in expandable details.
- Compact application shell with navigation that remains usable at small windows/Windows scaling. Account/signout and linking belong in relevant menus/screens rather than repeated primary actions. Keep keyboard focus, labels, contrast and light/dark themes.
- Overview reflects actual current counts and recent work, with no static waiting claim while requests/events already exist.
- AI Access explains the B-code step and permission duration. Approval form uses normal grid flow: input and button must never overlap. Preserve the existing B and optional Owner-consent validation.
- Sessions distinguish active, waiting and history; keep close controls only for the exact authorized local device.
- Live Monitor presents readable task history and a friendly activity timeline, filters and bounded rendering. Full job IDs/event types remain accessible in details. Do not invent command titles/output not exposed by the API; cancellation remains exact-device and explicitly confirmed.
- Devices offers understandable connection states, platform names and working linking actions. Do not display an unavailable-source warning beneath a successful inventory merely because mutation is separate.
- Long Memory emphasizes saved work, clear enable/disable, project creation and sync selection. Move storage internals/revisions/destructive operations into relevant details. Keep safe typed deletion and automatic CAS saves.
- Codex emphasizes setup, sign-in and tasks. Show human-readable task/runtime states; separate optional maintenance and explicit delegation/observer actions.
- Account emphasizes identity, plan and useful usage; settings groups contain working navigation rather than inert section labels. Technical permissions and recovery remain reachable without dominating ordinary use.
- Consent/login uses the same product visual language and clear scope/Cancel/Continue choices. Do not change OAuth/PKCE/CSRF semantics or claim browser Wall SSO is already seamless.

## Reproduced source causes and acceptance

The old `.approval-surface .lr-button` has `margin-top:-36px`; shared `.feature-table td` has `padding:0`. Existing visual QA uses empty unauthorized previews and therefore misses populated table/B-form geometry. Correct both and add meaningful populated renderer checks, long names, >100 jobs/events, light/dark, 390/768/1024/1280 widths and an effective 150% desktop scaling viewport. Validate no input/button intersections, readable table cells, no page overflow, filters/details, Owner change cleanup and preserved authority tests.

Native installers must be built in Actions from an exact published work commit, internal testing only. Retain old source/runtime/state and rollback. Full CI and hashes precede main promotion or giving the Owner the new installer. Existing Agent/backend deployment does not need an unrelated restart for Desktop CSS.
