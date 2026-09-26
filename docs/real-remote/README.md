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

Mouse and keyboard mutation remains desktop-input through Windows SetCursorPos/SendInput. V0.5-B accepts browser-cdp semantic sessions in the closed-loop desktop-input ACK: semantic coordinates drive OS input, then CDP refreshes the semantic snapshot/journal as observation-only ACK evidence. CDP does not dispatch mouse/keyboard input or inject page script.\n\nV0.6-A adds a bounded pull-based visual desktop session as the bridge toward live viewing without creating a second transport or device identity:\n- desktop-attach binds one indexed screen, displayTopologyId and bounded frame settings and returns desktopSessionId, epoch and frameSeq=0;\n- desktop-frame with desktopSessionId captures only on demand, reuses the attached screen/settings and advances frameSeq after each successful capture, so the caller itself provides backpressure and no background frame queue is created;\n- desktop-resume validates that the helper-side session still exists and the display topology/DPI has not changed, then reports its current frameSeq/config;\n- desktop-detach removes the session and reports the final frameSeq; detached ids cannot be resumed;\n- display changes fail desktop-frame/resume as desktop_session_stale_topology so the controller re-attaches instead of silently switching monitors;\n- helper state is bounded to eight simultaneous visual sessions. This is still a JPEG pull transport, not the final continuous video codec/stream.
