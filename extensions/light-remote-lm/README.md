# Light Remote LM v0.2 — Chrome extension (Gold preview)

Light Remote LM is an optional Chrome Manifest V3 extension for capturing **ChatGPT conversations that are presently loaded in the web page**. It stages the user's capture in the existing authenticated **Light Remote Gold Local Wall**. The owner then selects a verified Memory Scope and explicitly approves saving it.

This is not a new MCP server, storage engine, Project app, browser API integration, or tunnel. It reuses Gold's local SQLite, scope isolation, Home signatures and sync policies, including the existing full-context import endpoint.

## Install (unpacked)

1. Install/enable Light Remote Gold Agent on the same computer as Chrome. Confirm its Local Wall is reachable at http://127.0.0.1:5491/long-memory and log in there.
2. Open chrome://extensions, turn on Developer mode, and select **Load unpacked** for this directory.
3. Open a ChatGPT conversation in Chrome at https://chatgpt.com/. Scroll upward to load older turns **before capture** if required.
4. Click the Light Remote LM toolbar icon, then **Capture visible conversation**.
5. Review the message count and click **Review in Local Wall**.
6. In the opened Wall tab, review the imported text, **select the intended Memory Scope**, enable **Allow full-context snapshots for this scope** (if not enabled), then click **Save complete context** and confirm.

The extension does not click Save, choose or create a scope, or turn on full-context opt-in. Gold will enforce authoritative Home-only saving, owner auth/CSRF, 512 KiB limit, provenance and Ed25519 checkpoint signature.

## v0.2: limited borrowing of ideas from Browsentic

- The owner still starts capture manually by clicking the Chrome toolbar icon. No site-wide automation, recording, browser control, or new RM V2 capability is added.
- Visible transcript reads are divided into bounded 64 KiB UTF-8-safe pieces. Each piece is read against the **SHA-256 of the entire currently loaded transcript**; if the page changes between reads, the process fails closed instead of mixing old and new turns.
- A snapshot includes source URL, conversation ID when available, visible-turn count, timestamp, SHA-256 and an explicit LOADED-DOM-ONLY warning. Imported historical text is labelled untrusted data, never a new tool instruction.
- Chrome session storage holds the pending plaintext transcript temporarily while it is being handed to the Wall tab; preparation is allowed only for ten minutes and data is removed after successful staging or when that tab closes. The last successfully **prepared** snapshot retains only its source URL and SHA-256 (no transcript text in persistent Chrome storage). A repeat capture warns the owner; it is **not** deduplication against the Gold database and cannot prove whether an earlier snapshot was saved.
- The existing full-context import limit remains 512 KiB **including metadata**. Large conversations exceeding that limit fail with a clear message and are not silently clipped or auto-split into inconsistent Gold checkpoints.

The chunk cursor + stale-snapshot idea was inspired by Browsentic's read design, but this code is an independent, purpose-specific LM implementation. No Browsentic source was copied and no Browsentic permissions or daemon were added. The extension does not alter A/B, Codex Bridge, device sync policy, or Gold server configuration.

## Boundaries

- This v0.1 capture is explicitly user-initiated. It **does not** read hidden ChatGPT context, other tabs, prior sessions, conversation data not present in the DOM, or mobile app conversations.
- ChatGPT may virtualize or lazily render older messages. The snapshot says exactly what was captured and warns about missing history; it is **not an official export**.
- It captures user + assistant text only. It may omit formatting, attachments, tool payloads and non-text content. Treat images, audio, code diagrams, Canvas/Work content and citations as potentially incomplete.
- It does not send chat data to Light Remote cloud, Cloudflare or external analytics. For a short handoff to the Wall tab, the captured snapshot is temporarily held in Chrome's in-memory extension session storage (ten-minute expiry).
- Any visible transcript may contain sensitive data. Review and redact before saving. No automatic credential detection, redaction, or retention is claimed.
- Gold Local Wall defaults to the loopback address/port 5491. If your local port differs, this preview currently needs a code/manifest adjustment; it deliberately rejects remote hosts, LAN, NetBird or tunnels.
- It supports ChatGPT **Web** on chatgpt.com only and is not yet Chrome Web Store published.

## What is intentionally not in v0.1

Automatic background capture, auto-scoping, silent saves, OAuth shortcuts, cross-account memory sharing, server-side transcript collection, and bypassing owner confirmation. Future opt-in autosync requires independently designed per-conversation binding, stable origin checks, consent/revocation, idempotent delta protocol and a supported local ingestion contract.

## Testing

Run from the repository root:

    node deploy/scripts/selftest-gold-lm-extension.mjs

The selftest exercises UTF-8 chunk boundaries, SHA-256 reassembly, stale page rejection, Manifest V3 permissions, source restrictions, and staging-without-saving behavior. **It does not prove real Chrome/Gold E2E**; physical end-to-end acceptance is still required.

## Implementation notes

- src: capture.js (on-demand user-visible DOM extraction, bounded cursor with SHA-256 consistency check)
- popup: popup.html / popup.js / popup.css
- background: background.js (tab handoff; no remote API calls)
- target: the existing Gold Local Wall at /long-memory. The script populates #goldContextText and #goldContextTitle only.
- backend: existing device-agent/local-wall.mjs route POST /api/gold/modules/scope/context/save, invoked **only by the owner's existing Wall form**, with its CSRF/session and explicit fullContextOptIn.
