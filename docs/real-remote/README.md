# Real Remote

Real Remote is an experimental capability layer inside the existing Light Remote client. It is not a separate application and must not replace the current Light Remote control plane.

## Product invariant

The user continues to install and run one Light Remote client per machine.

Existing behavior remains unchanged:
- enrollment and device identity;
- Local Wall and A/B approval;
- tray/application lifecycle;
- signed updater and release channels;
- filesystem, search, process, PTY, SCP and policy;
- V / Primary, Reviewer and N / Backup repository lanes.

Real Remote adds desktop/live capabilities to the same enrolled device.

## Runtime model

The existing Light Remote Agent remains the owner of cloud connectivity, identity, policy and capability advertisement.

Real Remote extends the Agent with:
- desktop session discovery;
- live screen capture;
- mouse, keyboard, wheel and hotkey input;
- window and focus events;
- semantic UI metadata where the operating system provides it;
- attach, detach and resume semantics.

An OS-specific helper may be spawned internally when required by the operating system. Such a helper is an implementation detail of the Light Remote client, not a second application, installer, pairing flow or device identity.

## Windows first

The Windows native client already starts the Node Agent from the interactive user context through AgentSupervisor. This makes Windows the first target for Real Remote.

Initial Windows path:

Light Remote native app
  -> existing AgentSupervisor
  -> existing Node Agent
  -> Real Remote Windows adapter/helper
  -> interactive desktop

The first milestone must not require a separate user-facing Windows app.

## Capability surface

Initial experimental capability names:
- desktop.status
- desktop.attach
- desktop.detach
- desktop.frame
- desktop.input
- desktop.windows
- desktop.uia

The protocol should remain transport-independent so the same capability can later be used by ChatGPT, a Light Remote web UI, mobile clients or other approved controllers.

## Success criterion

V1 is successful when an authorized controller can say, in effect:

"remote Windows A, open the browser and fill this form"

and Light Remote can:
1. resolve the existing enrolled device;
2. attach to its live desktop;
3. observe the real screen;
4. drive the real mouse and keyboard;
5. adapt to visible UI changes;
6. detach cleanly;

without Playwright or DOM injection being the primary control path.

## Non-goals for V1

- replacing the current Light Remote app;
- replacing filesystem/process/PTY tools;
- creating a second device identity;
- creating a separate installer or updater;
- forcing Real Remote into V / Reviewer / N production before the feature branch passes acceptance;
- cloning Codex implementation details that are not required for interoperability or product behavior.

## Development rule

All Real Remote work stays on feature/real-remote until the feature reaches a stable acceptance milestone. Production main remains unchanged unless a shared-core change is independently useful and reviewed for the existing Light Remote product.

## Current experimental milestone

V0.3 adds bounded Windows input while keeping view and mutation as separate permissions:
- desktop.status: interactive desktop/session metadata;
- desktop.windows: visible top-level Win32 windows;
- desktop.frame: one bounded JPEG snapshot from the real desktop;
- desktop.input: bounded mouse, wheel, text and named-key batches.

The read path requires the desktop capability. Mutation additionally requires desktop-input, which is locally denied by default until the owner explicitly enables it in Local Wall. Both the host and Windows Agent enforce that capability boundary.

desktop.frame remains a control-plane proof, not the final Real Remote video transport. It defaults to at most 960x540 JPEG quality 50 and is hard bounded to 1280x720, quality 25..70 and roughly 650 KiB encoded JPEG bytes before base64. Input batches are limited to 64 normalized events and do not expose arbitrary raw INPUT packets.

Windows input uses SetCursorPos and SendInput from the existing LightRemote.Client.exe hidden helper. Windows UIPI and secure-desktop boundaries remain in force; Real Remote does not elevate around them.

V0.4-A adds the semantic foundation without changing the existing pixel or input paths:
- desktop-semantic-attach opens a bounded Windows UI Automation session and returns semanticSessionId, epoch and stateSeq=1;
- desktop-semantic-snapshot refreshes that same bounded semantic tree and advances stateSeq;
- desktop-semantic-detach closes the session;
- scope defaults to the foreground window, with desktop root available explicitly;
- maxDepth is bounded to 0..12 and maxNodes to 1..1500;
- nodes expose role/name/AutomationId/class/framework, process/window identity, bounds/center, focus/enabled/offscreen/password flags and supported UIA interaction patterns;
- V0.4-A deliberately does not read ValuePattern/TextPattern contents, including password contents.

V0.4-B adds continuous local semantic observation:
- the persistent Windows helper subscribes to UIA focus, structure and safe metadata-property events;
- events are kept in a 512-record in-memory journal and adjacent bursts are coalesced within 75 ms;
- desktop-semantic-events reads only entries newer than afterSeq, up to 200 at a time;
- stateSeq is shared by snapshots and journal entries, so a consumer can detect ordering and resume from its last acknowledged state;
- journal overflow reports gap/droppedBeforeSeq; focus leaving a foreground-scoped root reports scopeChanged/resyncRecommended;
- event subscriptions deliberately exclude ValuePattern.ValueProperty and text contents.

V0.4-C closes the input loop without adding a second mutation tool:
- desktop-input optionally accepts semanticSessionId, afterSeq and settleMs while keeping the legacy non-semantic response compatible;
- the semantic session is validated before any mouse/keyboard mutation, and an afterSeq ahead of the current journal state is rejected;
- successful semantic input increments inputSeq and returns the current stateSeq, cursor, foreground window, focused semantic element and journal events newer than afterSeq;
- the ACK carries gap, droppedBeforeSeq, scopeChanged, focusOutsideScope, resyncRecommended and hasMore so the controller knows whether to continue immediately, drain late events or take a semantic/visual resync;
- settleMs defaults to 90 ms and is bounded to 0..250 ms; events arriving later remain available through desktop-semantic-events from the returned state sequence.

This makes the normal control loop: semantic state -> bounded OS input -> semantic ACK -> next decision. Pixel frames remain checkpoint/resync evidence rather than the per-action transport.

Current Windows coordinate safety adds monitor-aware control without changing legacy global coordinates:
- desktop-status reports the virtual screen plus indexed screens, PerMonitorV2 awareness, per-screen effective DPI and a SHA-256 displayTopologyId derived from screen order/device/bounds/working-area/DPI;
- desktop-frame returns the selected screen index, physical bounds, effective DPI and the same displayTopologyId plus inputMapping; its xScale/yScale convert preview-frame pixels to screen-local pixels with nearest rounding;
- desktop-input without screen keeps legacy desktop-global x/y; when screen is supplied, x/y are local to that monitor; drag supports toScreen and defaults it to screen;
- callers can pin displayTopologyId from status/frame into desktop-input; a topology/DPI change rejects the request as desktop_input_stale_topology before SendInput, and successful closed-loop ACKs echo the applied displayTopologyId;
- the Plus/Vercel operator projection preserves displayTopologyId end to end.

V0.5-A adds a read-only Chromium semantic provider while preserving the same desktop control plane:
- desktop-semantic-attach accepts provider=browser-cdp in addition to the default windows-uia provider;
- browser-cdp attaches only to an already-enabled loopback Chromium DevTools endpoint; Light Remote does not launch a browser or enable remote debugging;
- explicit cdpEndpoint values and discovered WebSocket debugger URLs must resolve to loopback, and proxy/redirect following is disabled for CDP discovery;
- target selection can use targetId or urlMatch, otherwise the helper prefers a page target matching the foreground-window title before falling back to the first page target;
- one persistent CDP WebSocket carries Accessibility, DOM and Page commands/events for the semantic session;
- Accessibility.getFullAXTree plus DOMSnapshot.captureSnapshot are mapped into the existing semantic node shape, including role/name, hierarchy, DOM id/class/tag, focus/state, viewport bounds, paint order and a clearly-labelled screen coordinate estimate when browser window metrics are available;
- Page/DOM/Accessibility changes are retained in a bounded 512-event journal using the same epoch/stateSeq resume model;
- the browser semantic provider does not use Runtime.evaluate, does not inject page script, and does not mutate the DOM.

Mouse and keyboard mutation remains desktop-input through Windows SetCursorPos/SendInput. V0.5-B accepts browser-cdp semantic sessions in the closed-loop desktop-input ACK: semantic coordinates drive OS input, then CDP refreshes the semantic snapshot/journal as observation-only ACK evidence. CDP does not dispatch mouse/keyboard input or inject page script.

V0.6-A adds a bounded pull-based visual desktop session as the bridge toward live viewing without creating a second transport or device identity:
- desktop-attach binds one indexed screen, displayTopologyId and bounded frame settings and returns desktopSessionId, epoch, frameSeq=0 and contentSeq=0;
- desktop-frame with desktopSessionId captures only on demand and reuses the attached screen/settings; no background frame queue is created;
- desktop-resume validates that the helper-side session still exists and the display topology/DPI has not changed, then reports its current frame/content sequence and config;
- desktop-detach removes the session and reports its final sequence state; detached ids cannot be resumed;
- display changes fail desktop-frame/resume as desktop_session_stale_topology so the controller re-attaches instead of silently switching monitors;
- helper state is bounded to eight simultaneous visual sessions.

V0.6-B makes that JPEG pull loop practical over the existing Plus/Vercel control plane:
- desktop-attach accepts minIntervalMs=0..5000, default 250 ms, and omitUnchanged, default true;
- a desktop-frame poll before the cadence window expires returns throttled=true plus retryAfterMs without capturing a frame and without advancing frameSeq/contentSeq;
- every completed capture advances frameSeq; contentSeq advances only when the encoded JPEG content changes;
- every completed capture returns frameSha256; when omitUnchanged=true and the hash matches the previous frame, the response keeps frameSeq/contentSeq/hash metadata but returns data=null and dataBytes=0 instead of retransmitting the same JPEG;
- changed frames still carry the bounded JPEG, inputMapping and topology pin, so the same response can drive screen-local input;
- the caller owns polling cadence and backpressure. This is still a bounded JPEG pull transport, not the final continuous video codec/stream.

V0.6-C gives visual desktop sessions a bounded idle lease so abandoned controllers cannot consume helper slots indefinitely:
- desktop-attach accepts idleTimeoutMs=250..900000, default 120000 ms, and returns lastActivityAt/expiresAt lease metadata;
- successful desktop-frame polls, throttled polls and desktop-resume renew the lease; the response reports the renewed lease deadline;
- access after the idle deadline removes that session and returns desktop_session_expired;
- a display topology/DPI mismatch removes that session before returning desktop_session_stale_topology, so a stale screen binding cannot be resumed later;
- desktop-attach prunes all expired sessions before enforcing the eight-session helper limit, allowing capacity to recover even when a controller disappears without desktop-detach.

V0.6-D exposes the pull session through the existing Local Wall instead of introducing a separate remote-desktop service:
- the authenticated Local Wall adds a Desktop page and a CSRF-protected /api/desktop route;
- that route delegates back to executeDesktopCommand, so desktop view still requires the local desktop capability and every mouse/keyboard mutation still requires the separately owner-enabled desktop-input capability;
- the viewer can choose an indexed monitor, frame cadence and JPEG quality, then drives attach/frame/resume/detach while honoring retryAfterMs and keeping the previous image when an unchanged frame suppresses JPEG data;
- clicking, dragging, right-clicking and wheel input are converted from the rendered image through frame inputMapping and sent with the frame displayTopologyId pin;
- text and bounded named-key input use the same desktop-input path; disabling desktop-input leaves the viewer read-only;
- hidden tabs stop polling, visible tabs resume the existing session, expired/stale/missing sessions re-attach, and page unload makes a best-effort detach request;
- the page uses the same Wall login and per-render mutation CSRF. Unauthenticated page/API access and mutation without CSRF are rejected by the existing Wall boundary;
- the viewer module is included in core-files plus Windows and Linux install paths so installed clients do not lose the page after update.

V0.6-E adds a Windows CI hard gate for the Local Wall viewer against the real native helper:
- the acceptance starts the existing Local Wall on loopback and routes /api/desktop into NativeDesktopBridge using the staged LightRemote.Client.exe --real-remote-helper;
- it proves the rendered Desktop page is present, native desktop status exposes an interactive screen, and a real visual session can attach to that screen;
- it captures a bounded JPEG through the Local Wall API, verifies displayTopologyId and inputMapping, then resumes and detaches the same desktopSessionId;
- this acceptance is intentionally read-only. Mouse and keyboard mutation remain covered by the separate desktop-input Windows acceptance suite;
- the workflow step is a hard gate immediately after the hidden-helper smoke and before OS-input acceptance.

V0.6-F separates device authorization from runtime permissions so a normal version upgrade never requires re-authorization:
- authorization binds the device identity/key and Device ID; upgrading the installed binary does not replace or re-enroll that identity;
- signed heartbeats now carry effective capabilities and a separate supportedCapabilities set. Older agents remain compatible with the legacy heartbeat shape;
- when the same authorized Device ID reports newly supported capabilities, the server refreshes that binding's grantable set and signed policy revision instead of treating the change as a new enrollment;
- Local Wall Permissions renders capabilities supported by the installed runtime. Capabilities that did not exist in the previous runtime baseline are added to the local deny list by default, so they appear OFF after upgrade;
- the owner enables a new feature such as Desktop view, Desktop input or Interactive terminal only by checking it in Permissions and saving local policy. No enrollment code, account approval or Re-authorize flow is involved;
- server policy remains an independent remote-routing boundary and may still narrow a capability after runtime discovery; local policy remains the final deny boundary;
- legacy agents that do not send signed supportedCapabilities keep the prior capability-escalation guard;
- revoke remains an identity/trust action and may require authorization again; remove/delete remains a new-device enrollment case. Neither rule is used for ordinary version upgrades.

V0.6-G fixes upgrade migration after the capability refresh model change:
- an already-authorized, non-revoked device never needs re-authorization just because the runtime gained capabilities;
- stale local pending-enrollment state from the temporary reauthorization design is cleared automatically and cannot disable Connect;
- capability permission model version 2 migrates once from the authorization-era certificate baseline, so newly introduced runtime capabilities are locally OFF until the owner enables them;
- a polluted intermediate knownCapabilities list cannot auto-enable new runtime permissions during migration;
- fresh enrollment and subsequent permission saves stamp the new permission model explicitly.

V0.6-H tightens Local Wall responsiveness and short-lived pairing UX:
- expired Local Wall A codes rotate immediately instead of requesting the current challenge again;
- device/session activity coalesces status refreshes and enforces a small minimum refresh gap so event bursts cannot create overlapping remote-status fetches and repeated DOM rebuilds;
- outbound leaf long-poll defaults to 2.5 seconds instead of 8 seconds, bounding interactive command pickup latency when an otherwise valid server-side wake is missed by transport/proxy timing;
- all values remain environment-overridable and existing connection/policy boundaries are unchanged.

V0.6-I fixes Local Wall permission persistence and first-paint responsiveness:
- daemon-mode permission saves mutate the live daemon state, persist the explicit allowed capability set, and immediately refresh device capability policy with the server without reauthorization;
- explicit owner permission choices are separated from capability-discovery migration so a saved allow decision cannot be reinterpreted as a newly discovered default deny;
- Local Wall status is local-first with a short-lived remote cache; diagnostics/approval may request a fresh remote status explicitly;
- initial activity history is bounded and deferred until after first paint, and the shared SSE activity pump runs at a reduced cadence with a smaller bounded fetch.
