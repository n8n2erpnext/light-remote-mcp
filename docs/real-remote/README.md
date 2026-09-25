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

Windows input uses SetCursorPos and SendInput from the existing GptOperator.Client.exe hidden helper. Windows UIPI and secure-desktop boundaries remain in force; Real Remote does not elevate around them.

V0.4-A adds the semantic foundation without changing the existing pixel or input paths:
- desktop-semantic-attach opens a bounded Windows UI Automation session and returns semanticSessionId, epoch and stateSeq=1;
- desktop-semantic-snapshot refreshes that same bounded semantic tree and advances stateSeq;
- desktop-semantic-detach closes the session;
- scope defaults to the foreground window, with desktop root available explicitly;
- maxDepth is bounded to 0..12 and maxNodes to 1..1500;
- nodes expose role/name/AutomationId/class/framework, process/window identity, bounds/center, focus/enabled/offscreen/password flags and supported UIA interaction patterns;
- V0.4-A deliberately does not read ValuePattern/TextPattern contents, including password contents.

The next milestone is V0.4-B: UIA event journal + coalesced diffs + input ACK/stateSeq so the Agent can stay synchronized continuously and only request a new frame when semantic state needs visual resync.
