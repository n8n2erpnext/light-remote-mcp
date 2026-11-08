# T11-F16/P02 — Windows build #649: signed ABV2 preview schema mismatch (2026-11-08)

## Physical observation (read-only diagnosis, not Owner/B acceptance)

The Owner installed Windows build #649 on DESKTOP-VA16D27 and supplied a screenshot of http://127.0.0.1:5491/approve showing "Signed A/B V2 requests unavailable" / "Cannot verify signed requests". The official Light Remote plugin did not expose Windows in its current topology, but a pre-existing approved Light Remote ABV2 session did: resumed SAME Windows session without initiating A/B or minting/approving any B.

On Windows, installed Desktop V4, Tray and Node Agent are running; Agent's Wall listens on 127.0.0.1:5491 and returns /approve HTTP 200. 5492 has no listener; unrelated to the failure. Unauthenticated GET /api/abv2/pending returns 401, as expected for protected Owner content. GoldABV2 device state is enrolled and cloud-connected, with a current signed Agent and an existing valid session. The old legacy Agent state also exists but is not the GoldABV2 enrolled principal. No credential, cookie, B, private key or raw account identity was extracted.

The Windows Agent is the #649 client contract from device-agent/operator-agent.mjs: its remoteAbV2PendingPreview requires result.ownerConsentRequired and result.ownerApproveEnabled both to be Boolean. If missing, it raises abv2_signed_preview_invalid (status 503), and device-agent/local-wall.mjs maps the signed-preview failure to local /api/abv2/pending HTTP 503 with the generic unavailable UI in wall-ab-v2-preview.mjs.

## Exact active ABV2 Lab Operator schema skew

Current ABV2 Lab is LXD light-remote-abv2-lab-20261101, NOT the older light-remote-gold-uat container. The active ABV2 Lab Operator process runs:
 /opt/light-remote-abv2-lab/t08-617-operator-0f3c2ee1-STAGED/operator-host/executor.mjs

Read-only inspection of its operator-host/gold-ab-v2-signed-preview.mjs return object shows ownerApproveEnabled present but ownerConsentRequired ABSENT. Therefore the signed response is incompatible with Windows #649; that missing field is a sufficient deterministic cause of the client rejecting the response before display. Other possible runtime issues after that incompatibility is fixed have not been ruled out.

All nine ABV2 Lab feature switches for pending Owner HTTP, signed preview, signed approve, Owner consent, durable grant bridge, Owner approve, helper request issue/target query and Account UI are enabled. The ABV2 seal key path and Owner origin are configured. Do NOT confuse with older Gold UAT, where those switches are OFF. There is no justification to flip any flags or rebuild the Windows client.

Windows agent.log has capability catalog sync errors (device_channel_action_denied), brief renew timeouts and unrelated disabled Gold module notices. Those logs do NOT establish a causal link to /approve; signed preview result field mismatch is confirmed directly against the active Operator source.

## Minimal server-only remediation, staged/NOT deployed

Use the current repository code as the source of truth:
- operator-host/gold-ab-v2-signed-preview.mjs imports goldAbV2LabWallBOnly from lib/gold-ab-v2-lab-v1-lock.mjs.
- In the signedPreview return object, retain existing ownerApproveEnabled and ADD exactly the policy field ownerConsentRequired: !goldAbV2LabWallBOnly(env).
- The deployed ABV2 Lab candidate already has lib/gold-ab-v2-lab-v1-lock.mjs exporting goldAbV2LabWallBOnly, but its signed-preview module does not import the helper.
- NEVER hardcode ownerConsentRequired=false or bypass the strict Windows validation; this value is derived from the same server-side B-only policy that governs approval. Do not modify pending storage, grant TTL, B, consent proofs, owner email, Account binding, signature verification or other security checks.

Local source checks PASS:
 node deploy/scripts/selftest-gold-ab-v2-signed-preview.mjs
 node deploy/scripts/selftest-gold-ab-v2-wall-preview.mjs

These prove current source contract, NOT live ABV2 Lab acceptance. For a future approved change: create a new isolated candidate with this additive backport, run Node syntax, signed-preview and Wall auth/owner-consent tests on that candidate, verify package origin/profile and rollback checkpoint; only after explicit Owner permission atomically promote the LAB Operator service, observe health, and test same-device /api/abv2/pending with the authenticated Owner via Local Wall. If an active B grant is present, do not invalidate it unnecessarily. On failure, revert to the prior exact Operator candidate and restore service health.

## Status / permissions

F16/P01 hosted Windows artifact intake and Gold GC remain SUCCESS on source a72600f0f897eadea305cfdb387a67404ebc07e8. F16/P02 physical Windows installation is OBSERVED, but signed-preview UI FAILS schema parity and genuine Owner B/local Wall acceptance is OPEN. No B was created/reused, no enrollment or owner policy mutated, no service restarted, no lab/prod deployment and no update feed changed during this investigation.

NEXT: Owner approval is required before applying the narrow compatibility patch to the LIVE ABV2 Lab Operator. Production and older Gold UAT remain untouched. Until approved, this is a documented, verified cause and proposed patch, not a deployed fix.

## 2026-11-08 — T11-F16/P02-B ABV2 Lab Operator preview compatibility DEPLOYED + Windows #649 verification

Owner explicitly authorized the minimal ABV2 LAB Operator compatibility patch, testing and rollback in this chat. No approval for production, old Gold UAT, new A/B pairing, existing grant invalidation, or signed feed activation.

**LAB isolated promotion:** LXD light-remote-abv2-lab-20261101, unit light-remote-gold-operator.service. Previous unchanged candidate /opt/light-remote-abv2-lab/t08-617-operator-0f3c2ee1-STAGED, signed preview file SHA256 85f6faf30ef57ebb7ba2f04b0da1c888fd69687abcf31ec451e3677ff68a4210. New cloned candidate /opt/light-remote-abv2-lab/t11-f16p02-owner-consent-preview-20261108; sole executable source delta in operator-host/gold-ab-v2-signed-preview.mjs: import existing goldAbV2LabWallBOnly helper and add ownerConsentRequired: !goldAbV2LabWallBOnly(env) to signed-preview JSON. Candidate preview SHA256 e161df5f74bd4c06048bf5e2830ab984ae2238f178673b2207179446e74189ce. No Account/Device/Owner grant logic, signature, B proof or policy flag modified. Git source already contained correct field; no new source rewrite is needed.

**Candidate tests PASS:** node --check; current scoped signed-preview fixture run AGAINST candidate emitted GOLD_ABV2_SIGNED_DEVICE_PREVIEW_SCOPED_NO_B_NO_MUTATION=PASS; isolated signed-approval fixture emitted GOLD_ABV2_LAB_SIGNED_LOCAL_OWNER_B_NO_EXTRA_VISIBLE_CONSENT=PASS and GOLD_ABV2_SIGNED_WALL_OWNER_B_PG_DURABLE_GRANT_SCOPE=PASS. Synthetic tests never issued a live B. No test fixtures retained in candidate.

**Controlled service promotion:** Created a later-sorting new systemd drop-in for only the ABV2 LAB Operator ExecStart/WorkingDirectory, did not edit existing drop-ins/env. systemctl daemon-reload and restart succeeded. /proc live Operator exec now points to new candidate; light-remote-gold-operator.service and light-remote-gold-plugin.service both active. Live B-only LAB flag remains enabled, so policy-derived ownerConsentRequired=false. Prior candidate and systemd drop-in unchanged. Rollback metadata + previous final drop-in backup and syntax-validated manual rollback script (NOT executed) at /root/light-remote-f16p02-owner-consent-20261108/rollback_operator.py inside LAB. This script removes only the new override and reactivates prior candidate if later needed.

**Real Windows #649 UI:** Reused existing A/B-authorized Light Remote AB session for DESKTOP-VA16D27 without new A or B. Actual Google Chrome at http://127.0.0.1:5491/approve changed from Signed A/B V2 requests unavailable to No pending requests. Fresh direct navigation to /approve again showed No pending requests, validating successful signed-preview read/render. Local Wall dashboard separately showed Live, device Short ID S9X0R0, cloud connected, one active Agent with remaining authorization; preexisting session survived LAB restart. Neither Windows installer nor local Agent restarted.

**Boundaries:** F16/P02 signed-preview fix DEPLOYED and VERIFIED on LAB and Windows. There is NO current pending Agent request, so entering B and pressing Approve on the patched LIVE Wall was NOT tested. This is not a claim of new human B grant. The synthetic signed-approval tests passed; any future real B approval must follow a genuine new Agent request and manual Owner B entry at the same Wall. Do not create or replace active A/B grant automatically. Gold production, old Gold UAT, signed updater, SSO, enrollment, Long Memory all untouched.

NEXT F16/P03: owner-initiated pending request and real Local Wall B approval when Owner explicitly chooses to do so, with active 24h lease preserved until that decision. If incompatibility returns, check new signed error and use LAB-only manual rollback script.
