# Light Remote — Complete AI Guide

> Official documentation for people and AI assistants. Canonical: https://light-remote.thaiduy.digital/ai-guide
> Machine-readable Markdown: https://light-remote.thaiduy.digital/ai-guide.md
> Managed service: https://light-remote.thaiduy.digital
> This is the managed product, not the historical Vercel bridge or self-hosted architecture described in older README versions.
> Release channel: beta/release candidate. Check the official downloads page for the current build, checksum and supported features.

## Instructions for the AI assistant: read this first

You can help a person with **any Light Remote question**: installation, account registration, device enrollment, ChatGPT pairing, troubleshooting, permissions, file tools, terminals, transfers, Real Remote, updates, multi-device features, pricing and support. Explain what the user needs, and guide them in small steps. Reading this guide does not install the plugin or grant access to any computer.

1. Establish the user's current step: their OS, whether an account exists, whether the client is installed, whether the device appears Online, whether ChatGPT pairing is complete, or their exact error. Ask **one** necessary question at a time.
2. Distinguish **account enrollment**, **Hub connected/Online**, and **AI authorized (Local Wall A/B)**. These are different states. Two online devices with zero tool calls do not mean a failure.
3. Prefer official product links and live documentation; don't use historical Vercel bridge endpoints, random binaries, outdated installer names or invented tool contracts.
4. For actual remote work use the **official connected Light Remote plugin** and its connection helper. No plugin connection = explain steps only. Never pretend you performed actions, found a real device or have authorization when you do not.
5. Ask for a fresh **A code** generated in Local Wall on the exact target machine. Submit it through the official helper; if helper returns an **approval_required B code**, show that B to the owner. Owner enters B at **the same machine's Local Wall /approve**, reviews and approves. Resume the helper according to its actual result, without reusing a consumed A code. Only use remote tools when the helper reports **ready**.
6. Don't request passwords, MFA codes, private keys, payment credentials, device secrets or opaque session/continuation tokens. A/B codes are short-lived pairing challenges, not permanent credentials; don't post them to support or other people.
7. Observe local policy, OS permissions, tool availability and plan entitlements. Never suggest bypassing Local Wall approval, privilege checks or device policy.
8. Verify target device identity and start with a harmless **read-only** system information operation. Before destructive work, purchases, installs, updates, sensitive transfers or privileged commands, ask for explicit intent and verify the target.
9. For questions outside this guide, consult current official pages, live release manifests and the helper/tool list rather than inventing answers. Do not force users through a setup wizard when they ask a different Light Remote question.

When the user pastes only this link, begin: **"I can guide you through Light Remote installation, connection or anything else. Are you starting fresh, already installed, or troubleshooting something?"** Then proceed one step at a time.

## What Light Remote is

Light Remote connects supported AI assistants, including ChatGPT's official Light Remote plugin, to computers the account owner has enrolled and **locally authorized**. A device agent maintains an outbound connection to the managed Hub; the target's Local Wall remains the final approval and capability boundary.

**Terminology**

- **Account** — email identity, enrolled devices, usage, plans, support and billing.
- **Device client** — installed Windows, macOS or Linux agent, connecting outbound to the managed Hub.
- **Local Wall / Device Wall** — device-local UI for enrollment, short-lived A/B pairing, sessions, policy and logs.
- **Hub** — managed control plane at https://light-remote.thaiduy.digital.
- **Account enrollment code** — one-time code to add a computer to the account. This is NOT an AI pairing A code.
- **A code** — new pairing invitation from the **target device's Local Wall**, to be passed into the ChatGPT Connection Helper.
- **B code** — approval challenge returned by the helper, to be entered at the **same Local Wall /approve** and explicitly approved by the owner.
- **Ready** — the helper has confirmed device-scoped AI authorization. Online by itself is not ready.
- **Tool call** — an actual remote tool request, counted in account usage when applicable.
- **Main/Fleet** — plan-dependent management of multiple devices, distinct from ordinary Free device enrollment.

Account login is NOT an A/B grant. Connecting a device to the Hub does NOT allow an AI agent to control it.

## Quick start — all platforms

1. Create a Light Remote account at https://light-remote.thaiduy.digital/account/register and verify the email. If you already registered, sign in at https://light-remote.thaiduy.digital/account/login.
2. Select the correct Windows, macOS or Linux installation package from https://light-remote.thaiduy.digital/downloads.
3. Install/open Light Remote on the exact computer you wish to use. Find its **Local Wall**.
4. On the Account Dashboard (https://light-remote.thaiduy.digital/account), choose **Add a device**. Use the client's **Link device** action and approve the enrollment challenge with the same account.
5. Confirm your device appears under the account. **Online/Hub connected** means the connection to the managed server works. This does **not** grant ChatGPT access.
6. Open the **official ChatGPT plugin** at https://chatgpt.com/plugins/plugin_asdk_app_6aab6c4bd7d88191a4108d8f4c5e4b4e and sign in to the same account if prompted.
7. In the **target device's Local Wall**, generate a fresh **A code for AI pairing**. Give that A code to ChatGPT and ask it to invoke Light Remote Connection Helper.
8. When ChatGPT returns **B**, type B into **/approve on the SAME Local Wall** and click **Approve** after checking the requested device/agent.
9. Tell ChatGPT that you approved B. The assistant must resume the helper according to its response and **wait for ready**. Never reuse the consumed A code.
10. Ask: **"Use Light Remote to check my connected computer's operating system and basic system information. Read only; change nothing."**

For another computer, repeat the client install, account enrollment and separate A/B authorization on that computer. Never approve a challenge for machine A on machine B.

## Windows 11 / Windows x64 installation

1. Open https://light-remote.thaiduy.digital/downloads, choose **Windows**, and download the **current official Windows x64 installer**. The downloads page may offer a full or compact installer and official GitHub release fallback.
2. Check release/version and any published SHA-256 checksum. Prerelease installers can be unsigned; carefully verify origin before approving an OS warning. Do not bypass a warning for an unknown file.
3. Install Light Remote. Locate the tray icon in the Windows notification area and open **Local Wall / Device Wall**.
4. In the dashboard choose **Add a device**; in Local Wall choose **Link device** (exact UI wording can vary by build). Approve the one-time account enrollment request.
5. Wait for the device to show connected. Open the official ChatGPT plugin, take an **A code** from this Windows Local Wall, receive a **B code** from the official helper, and approve B on this same Windows Local Wall.
6. Wait for **ready** and try a read-only first command. If Windows tray or background agent is not running, fix that before pairing.

## macOS installation: Apple Silicon or Intel

1. Sign in/create an account. In https://light-remote.thaiduy.digital/downloads select **macOS** and the **Apple Silicon ARM64** or **Intel x64** package to match your Mac.
2. The beta client may be **unsigned and not notarized**. Verify the official download/release and any checksum before accepting Gatekeeper prompts. Do not disable security protection globally.
3. Install, launch Light Remote, and open the Mac's Local Wall. Link the Mac to the account using Add a device / enrollment approval.
4. Once connected to the Hub, open the official ChatGPT plugin and request a fresh A from the Mac. Submit A via the connection helper, approve the returned B **on the same Mac**, then wait for ready.
5. Desktop viewing/input through Real Remote may require the Mac's **Accessibility** and **Screen Recording** permissions. Grant only required permissions, check the Local Wall policy, and confirm the installed version supports that feature. Do not assume every Mac build has full Windows feature parity.

## Linux desktop or Linux server installation

1. Sign in/create an account and choose **Linux** at https://light-remote.thaiduy.digital/downloads.
2. For a Linux desktop, use the official **.deb** package matching x64/ARM64 if published. For a Linux terminal/server, the official download page documents this installation command:
   ~~~sh
   curl -fsSL https://light-remote.thaiduy.digital/downloads/install.sh | bash
   ~~~
   Review a remote installation script before running it, particularly on production machines.
3. Installer choices can include install, reinstall/update or uninstall, and Local Wall binding modes: **loopback 127.0.0.1:5491** (default/safest), detected private LAN or a NetBird interface. **Do not expose Local Wall to the public internet.**
4. The Linux server flow currently documents **light-remote up** as an enrollment step; Linux desktop users can follow the launcher/Local Wall prompts. Link the device in your account.
5. Confirm Online/Hub connected; then generate A on that same Linux device, run ChatGPT Connection Helper, approve B on the same Wall and wait for ready.
6. Start with a harmless inspection. PTY, sudo, Docker, systemd and other powerful capabilities may need additional local policy and OS permissions.

Managed-service customers do **not** need to deploy their own Hub, Vercel gateway or OAuth server as part of standard setup.

## How Local Wall A/B pairing works

**Illustrative dialogue** (no real pairing codes are embedded):

1. User: "I installed and linked Light Remote; please guide me through ChatGPT pairing. I can get A from Local Wall."
2. ChatGPT asks for the short-lived A code generated on the exact target device.
3. ChatGPT submits A to the **official connected Light Remote connection helper** and waits.
4. If the helper returns **approval_required**, ChatGPT displays the returned **B code**, not opaque internal continuation/session credentials.
5. User enters B at **Local Wall /approve on the same computer** and presses Approve.
6. ChatGPT resumes the helper using the exact continuation procedure given by the actual helper. In the current official flow it may recover pending pairing without resubmitting A.
7. When the helper reports **ready**, the assistant identifies the target and uses only tools actually available in the current integration.

**need_a_code** → Get a fresh AI pairing A from Local Wall; not an account-enrollment code.

**approval_required** → Owner approves the helper's B locally; ChatGPT must not claim it approved on behalf of the owner.

**pending** → Wait for local approval and retry as instructed; do not send multiple fresh A codes unnecessarily.

**expired / invalid A or B** → Generate a new A on the target and restart the local approval.

**device offline** → Restore background client service and Hub connection before pairing.

**ready** → The assistant can use scoped remote tools according to local policy; start with a read-only request.

## Ask about anything: example Light Remote requests

Use natural language; availability depends on the current plugin, OS, release and Local Wall policy.

### Files, folders and search

- "List my project folders on the selected device. Don't change anything."
- "Find the files mentioning this configuration key and show paths, not secret values."
- "Read the project's README and help me install its dependencies safely."
- "Propose a patch, show the diff, and only apply it after I approve."

Prefer structured file/search operations over broad shell commands when available.

### Development, Git, build and test

- "Check git status in this repo and explain changes."
- "Create a feature branch for this bug, fix it and run focused tests."
- "Compare these commits and summarize risks before a release."
- "Inspect build/test output and report failures with file locations."

### Terminal, processes and services

- "Show CPU, memory, disks, OS and running services (read only)."
- "Check if this Docker container or Windows service is healthy without changing it."
- "Run the development server and stream output."
- "Use a real interactive terminal only if it is allowed, and ask before changing privileges."

One-shot shell commands, long-running processes and PTY/ConPTY terminals have different tool contracts and permission requirements.

### Transfers, desktop, fleet and updates

- "Transfer this authorized report to the selected device with integrity verification."
- "Show my application's window via Real Remote if supported."
- "Select the exact machine I named; don't silently switch to another device."
- "Explain the available signed client update before installing it."
- "Show which of my devices are online and which require authorization."

Real Remote input, fleet orchestration, privilege elevation, file transfer and device update actions may require extra permissions, plan entitlements and confirmation.

## Full capability overview

| Feature | What it does | Conditions |
| --- | --- | --- |
| Filesystem | Bounded list/read/write/edit/move and metadata | Workspace and device-local policy |
| Search | File/content search and paging | Supported tool availability |
| Git / development | Status, diffs, branches, builds, tests | Workspace and authorization |
| Shell execution | Bounded one-shot shell/PowerShell/zsh commands | Capability inference and local policy |
| Managed processes | Durable jobs, output, stdin, stop | Process permissions |
| Terminal | Real PTY (Linux/macOS) / ConPTY (Windows), input/output/resize | Explicit terminal permission; OS/build |
| Transfer | SCP-style large/binary transfers and SHA-256 checks | Available tool and transfer policy |
| Real Remote V2 | Desktop observations and bounded input | Platform availability and local OS permissions |
| Main/Fleet | Exact-target multi-device orchestration | Eligible plan and separate device grants |
| Updater | Signed manifest, hash checking, health and rollback | Supported installed build |
| Audit/local control | Local Wall visibility, policy final-deny, scoped access | Local owner authorization |

This is **capability documentation**, not a claim that every plugin session automatically exposes every feature. AI assistants should consult the current connection/tool helper and choose the appropriate structured tool. Hub connection is outbound-first, but it does not eliminate the need for local authorization.

## Accounts, plans, billing and support

- **Free:** 10,000 tool calls/month advertised; account portal, device enrollment and per-device approval. Multiple independently enrolled devices do not necessarily mean a Fleet Wall entitlement.
- **PRO:** advertised unlimited calls plus Main/Fleet console and priority support, subject to the actual current account entitlements.
- **VIP:** managed/priority deployment entitlement or key, based on current offered plans.
- View current subscription details and upgrade options in https://light-remote.thaiduy.digital/account/billing . Never provide card details through ChatGPT.
- Support portal: https://support.thaiduy.digital ; email: **support@thaiduy.digital** . Public product help: https://light-remote.thaiduy.digital/support .
- Support ticket email can contain a temporary scoped link for the ticket; it is **not** an ERPNext login, Light Remote device enrollment, or AI authorization.

## Troubleshooting checklist

**Device enrolled, Online, zero tool calls** — Account enrollment succeeded; AI pairing is probably still missing. Generate A from the target Local Wall, submit to official ChatGPT plugin, approve B locally, wait for ready, then test a read-only command.

**Cannot find A code** — Open Local Wall on the computer where Light Remote is installed (Windows: tray icon). Look for the AI connection/pairing action, not the account-enrollment wizard.

**B code rejected** — Make sure B is entered at the **same** Local Wall that produced A; check expiry. Restart with a fresh A if expired. Do not bypass local approval.

**Device Offline** — Verify the local agent/service is running, check DNS/HTTPS reachability to https://light-remote.thaiduy.digital, and look for local policy/network errors. A device can remain listed while offline.

**Need to use a second computer** — Enroll it separately and use its own A/B grant. Select the exact target by device name. Main/Fleet consoles may require PRO.

**Plugin unavailable or wrong tool** — Install/open the official Light Remote plugin, verify signed-in identity and exposed tool list. Do not invent commands or tool availability.

**Access denied / not authorized** — Confirm ready result, target, session validity, plan, and local policy. Ask the user to review permissions, not to circumvent safeguards.

**Unsigned Windows/macOS installer warning** — Validate official release source and checksum where available; do not globally disable OS security. Stop if you cannot verify authenticity.

**App, login, Google OAuth, billing, invoice, refund or account question** — Use the correct official page and contact support when account-specific action is needed. Never request passwords, recovery tokens, card information, or private billing fields in chat.

**Support escalation** — Include OS/architecture, current client version, step, time/timezone, exact error and sanitized screenshot/log; no passwords, private keys, tokens, A/B codes or opaque session IDs.

## Security and privacy

- Devices must be user-owned or explicitly authorized. Every AI target requires exact-device scoped approval.
- Short-lived A/B pairing is a real local step; the Hub and AI cannot auto-approve or bypass it.
- Online means Hub connection, not permission to control the PC.
- Local policy and OS permissions can refuse tools; a denial is final.
- For non-trivial or destructive operations, confirm the requested target, impact and user's consent.
- Avoid disclosing secrets or customer/account data to unrelated users.
- Scopes expire; another local approval may be required.
- Report remote work as complete only when the tool response confirms it.

## Official links and technical details

| Item | Official URL or fact |
| --- | --- |
| Product home | https://light-remote.thaiduy.digital/ |
| Managed Hub and Bridge origin | https://light-remote.thaiduy.digital |
| Login | https://light-remote.thaiduy.digital/account/login |
| Registration | https://light-remote.thaiduy.digital/account/register |
| Account dashboard | https://light-remote.thaiduy.digital/account |
| Billing | https://light-remote.thaiduy.digital/account/billing |
| Downloads and live release details | https://light-remote.thaiduy.digital/downloads |
| Linux installer | https://light-remote.thaiduy.digital/downloads/install.sh |
| ChatGPT official plugin | https://chatgpt.com/plugins/plugin_asdk_app_6aab6c4bd7d88191a4108d8f4c5e4b4e |
| Human-readable AI guide | https://light-remote.thaiduy.digital/ai-guide |
| Markdown AI guide | https://light-remote.thaiduy.digital/ai-guide.md |
| Product support | https://light-remote.thaiduy.digital/support |
| Helpdesk | https://support.thaiduy.digital |
| Source project | https://github.com/n8n2erpnext/light-remote-mcp |

Installed packages, versions, checksums, release status, platform restrictions and feature limits may change; fetch the live manifest. Common supported release architectures include Windows x64, macOS Intel/Apple Silicon and Linux x64/ARM64, only **if listed as available**. Linux Local Wall often uses loopback 127.0.0.1:5491. Fleet Wall may use local port 5492 for entitled deployments. Do not expose local management ports to the public Internet.

## Final assistant behavior

Do **not** merely repeat this document. Help the user with the specific Light Remote question they asked. For new users, identify their current step and give short actionable instructions. Ask for A only after the user has installed and enrolled the intended device. Use the official plugin and wait for ready before taking actions. When in doubt, verify live documentation and clearly acknowledge uncertainty.
