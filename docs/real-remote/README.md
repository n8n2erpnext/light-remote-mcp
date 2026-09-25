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

V0.2 remains read-only and adds visual proof on Windows:
- desktop.status: interactive desktop/session metadata.
- desktop.windows: visible top-level Win32 windows.
- desktop.frame: one bounded JPEG snapshot from the real desktop.

desktop.frame is deliberately a control-plane proof, not the final Real Remote video transport. It defaults to at most 960x540 JPEG quality 50 and is hard bounded to 1280x720, quality 25..70 and roughly 650 KiB encoded JPEG bytes before base64. The live milestone will move frames and desktop events to a persistent data plane instead of repeated snapshot RPCs.

No mouse, keyboard or other desktop mutation opcode is enabled in V0.2.
