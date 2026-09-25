# Light Remote Plus client 401 incident - investigation and mitigation record

Date: 2026-09-25
Status: MITIGATED / NEEDS SOAK - NOT DECLARED RESOLVED
Area: ChatGPT Plus bridge -> Vercel /api/operator -> gateway Plus auth -> AgentClientRegistry
Primary symptom: intermittent 401 agent_client_required with detail=invalid on an apparently valid Plus client session.

> This document is intentionally conservative. Live checks after the change are green, but the historical failing credential bytes were never captured, so the original incident root cause is not proven. Treat the current changes as a mitigation plus observability improvement until enough production soak time has passed.

## 1. Why this document exists

The failure was difficult to diagnose because the observable 401 invalid happened before registry lookup and before useful continuity telemetry. Several plausible causes looked identical from outside. This record preserves the established failure boundary, evidence, remaining hypotheses, rejected paths, code changes, rollout order, live validation, rollback state, and a debugging playbook if 401 returns.

Do not add raw A/B pairing codes, continuations, client capabilities, cookies, secrets, or signing material to this document.

## 2. Architecture at the time of the incident

Relevant request path:

    ChatGPT agent
      -> Vercel /api/operator?via=plus
      -> lib/operator.js
           x-light-client: <opaque credential>
           Cookie: light_remote_client=<same credential>
      -> gateway Plus auth
           requireClient()
           clientContext()
           wallAuth.verifyOAuthToken()
      -> AgentClientRegistry
      -> device/session/tool routing

Important distinction: a raw 401 agent_client_required / invalid from requireClient() occurs before AgentClientRegistry is consulted. Registry expiry, revoke, device binding, or account checks are therefore not the first failure point for this exact response shape.

## 3. Incident evidence

Astra 6.0 investigation status was INCONCLUSIVE, but it narrowed the failure boundary substantially.

Observed historical window:

- approximately 08:59:15-09:01:39 UTC on 2026-09-25;
- 28 Vercel GET /api/operator responses with HTTP 401;
- matching Traefik evidence showed 28 corresponding requests to the same backend;
- breakdown observed: 21 GET job requests + 7 POST context requests;
- response body size was consistently about 63 bytes;
- one bad higher-level invocation can fan out into multiple bridge requests, so request count is not equal to user actions.

Reference E9 lifecycle evidence:

- a known client was created/bound around 07:51:23 UTC;
- it continued working until about 08:52:51 UTC;
- it remained active with no recorded agent_client_closed;
- an expiry near 08:55 UTC belonged to a different client, so that expiry did not prove the failing client's identity.

The exact historical credential bytes that produced the 401s were not available. This is the main reason the root cause cannot be declared proven.

## 4. Failure boundary established in source

Original gateway behavior:

    clientTokenFromRequest(req)
      -> clientContext(token)
      -> wallAuth.verifyOAuthToken('client', token)
      -> if invalid: 401 agent_client_required / detail=invalid
      -> only after success: AgentClientRegistry

On the Vercel side, continuity logic first structurally decoded the credential. If decoding returned null, a transient 401 invalid escaped immediately instead of entering continuity retry/telemetry.

The following classes could therefore collapse to the same raw 401:

- malformed token shape;
- invalid payload encoding or invalid JSON;
- wrong scope;
- missing clientSessionId;
- missing agentId;
- expired credential;
- stale credential selected by the caller;
- another token-shaped credential that failed verification.

## 5. Hypotheses and what was learned

### 5.1 Strong candidate: caller selected the wrong old/stale credential

This remains a high-value hypothesis.

A stale credential can still match the outer token regex while being expired or otherwise no longer valid. The old continuity decoder returned null for expired or structurally bad credentials, so the request skipped retry logic and produced the exact raw 401 observed.

This is plausible when the conversation/tool context contains more than one historical client credential and the caller is responsible for inserting the opaque value into every URL.

Status: plausible, not proven.

### 5.2 Byte mutation or malformed credential in transport

Also plausible. The old flow required the model/caller to repeatedly splice a long opaque capability into query URLs. Any truncation, wrong copy, stale reconstruction, or malformed token could fail before registry lookup.

Status: plausible, not proven.

### 5.3 AgentClientRegistry as the primary cause

Not supported for the raw 401 shape investigated. Registry is downstream of successful token verification.

Status: ruled out as the first failure boundary for this response shape.

### 5.4 Signing key mismatch / bad secret mount / clock skew

Investigation checked auth source/secret mount consistency and system time. Synthetic verification behavior also matched expected signing rules.

Status: no evidence this was the incident cause.

### 5.5 Cookie fallback as a fix

Rejected. There was no evidence that independent Vercel web_fetch_vercel_url calls reliably preserve application cookies. The existing bridge also populated header and cookie from the same plusClient value, so cookie fallback would not repair a caller that selected the wrong credential.

Status: rejected.

### 5.6 Increase retry count or auto re-pair

Rejected as a primary fix. Retrying malformed/expired credentials only amplifies load, and silently re-pairing on arbitrary invalid auth weakens the trust model.

Status: rejected.

## 6. Important synthetic behavior before the mitigation

Tests established these classes:

- valid credential -> 200, one upstream request;
- valid payload with bad signature -> continuity eligible, retries, then 503 temporary-unavailable behavior;
- non-JSON payload -> raw 401, no continuity retry;
- missing agentId -> raw 401;
- expired credential -> raw 401;
- numeric-string exp had a schema mismatch: the old continuity decoder coerced Number(exp), while gateway verification required a safe integer;
- outer whitespace was tolerated;
- malformed preferred header plus valid cookie still failed because header transport won;
- some duplicate query-array shapes produced 401 without upstream work.

A single malformed tool invocation could result in about seven bridge requests. Combined with continuity retries, careless retry logic had the potential for significant amplification.

## 7. Patch 1 - diagnostics and exact READY handoff

Commit:

    503fa97 fix: diagnose client 401 continuity and exact helper replay

Goals:

1. make raw 401 failures observable without logging credentials;
2. correlate Vercel and gateway using a trace ID;
3. classify structural credential failures;
4. remove one caller reconstruction step after READY by returning an exact Tool Helper URL.

Diagnostics added around the client guard include redacted fields such as:

- traceId;
- action/path;
- deployment identifier;
- credential fingerprint (SHA-256 prefix only);
- credential length;
- decode/verify reason;
- selected transport;
- attempt/retry metadata.

Expected reason classes include values such as:

- missing;
- shape;
- json;
- scope;
- missing_client_id;
- missing_agent_id;
- exp_type;
- expired;
- eligible/valid;
- signature on gateway inspection.

Raw token values must never be logged.

A key logging gap was also addressed: compact Plus error responses previously returned before the normal operator_bridge warning path, which made raw invalid failures poorly visible.

READY behavior was changed so the server can return an exact helper.nextUrl for Tool Helper instead of only a placeholder requiring the caller to rebuild:

    /api/operator?via=plus&action=tool-helper&client=<exact credential>

The caller instruction is to replay helper.nextUrl exactly and keep it private.

## 8. Patch 2 - compact signed clientRef

Commit:

    204e654 fix: use signed compact client refs for Plus continuity

The new credential form is a compact signed reference with prefix:

    lr1.<client-session-reference>.<agent-reference>.<MAC>

Security properties:

- gateway validates the MAC/signature;
- the ref binds clientSessionId and agentId;
- AgentClientRegistry remains authoritative for active/expired/closed state;
- registry remains authoritative for device/account/session binding;
- local policy boundaries are unchanged;
- no cookie fallback was introduced;
- no automatic re-pair was introduced.

Important design choice: lr1 does not duplicate the registry's mutable expiry state in the URL credential. This reduces the chance that Vercel-side structural expiry interpretation diverges from gateway/registry state.

Legacy o1.client credentials remain accepted for compatibility and rollback.

## 9. Test coverage added or exercised

Targeted tests exercised during the work included:

- selftest-v11-client-continuity.mjs;
- selftest-v11-client-diagnostics.mjs;
- selftest-v09-client-resilience.mjs;
- selftest-v09-plus-vercel-bridge.mjs;
- selftest-v09-pairing-connect-flow.mjs;
- selftest-v09-plus-auth.mjs.

Important regression behavior:

- expired/non-decodable legacy credentials do not get blind continuity retries;
- lr1 invalid auth also does not get blind continuity retries;
- malformed credentials remain fail-closed;
- exact READY Tool Helper URL is asserted;
- diagnostics are redacted and do not expose raw capabilities.

Full portable suite result before production rollout:

    110 total
    109 PASS
    0 FAIL
    1 live-host test skipped by design

git diff --check was clean before the clientRef commit.

## 10. Deployment and rollout record

Repository:

    n8n2erpnext/light-remote-mcp

Relevant commits:

    75d3083 baseline main before this incident fix
    503fa97 diagnostics + exact helper replay
    204e654 compact signed clientRef

Branch used during development:

    fix/client-credential-continuity

The fix branch was confirmed to be a clean fast-forward of origin/main. Main was later advanced to 204e654 and pushed.

### Gateway drift caution

The production gateway was not rebuilt blindly from the current repository because the live gateway was version 0.9.0-rc.24 while the working branch had later rc.25/rc.26 drift in unrelated gateway files.

Live rc.24 was mapped against repository history. The production fix was deliberately built from the live rc.24 image and overlaid only the required 401/clientRef gateway changes.

Production gateway image tag:

    light-remote-gateway:fix401-204e654

This avoided accidentally rolling unrelated oauth/security/transfer/workspace changes into the 401 incident.

### Persistent compose state

The service directory is:

    /home/ubuntu/services/lightbi-mcp-poc

A previous override mounted an old hot-patch:

    /opt/gpt-vps-operator/gateway-patches/plus-auth.mjs

That mount could have reintroduced old auth behavior after a later compose recreate.

The effective override was changed to pin the tested image and explicitly reset build inheritance:

    services:
      lightbi-mcp-poc:
        image: light-remote-gateway:fix401-204e654
        build: !reset null

The final effective compose config showed the pinned image and no stale plus-auth mount.

The old rc.24 image was retained as a rollback base.

## 11. Live validation sequence

The strongest live evidence came from a controlled before/after test using the same newly minted lr1 credential.

Sequence:

1. Gateway had already been updated to understand lr1.
2. A fresh A/B pairing completed and READY minted an lr1 credential.
3. Production Vercel was still on the old main deployment.
4. Tool Helper using that lr1 returned HTTP 401.
5. The same code branch was already built successfully as a Vercel preview, but preview access was protected by Vercel Deployment Protection, preventing a clean connector-side direct API test.
6. main was fast-forwarded to commit 204e654.
7. Vercel production deployment for main@204e654 reached READY and lightremote.thaiduy.digital moved to it.
8. The exact same lr1 credential that had just returned 401 was retried.
9. Tool Helper returned HTTP 200.
10. A real fs stat call through the same lr1 credential also returned HTTP 200.
11. Runtime logs on the new deployment showed tool-helper 200 and fs 200.

This proves a concrete compatibility mismatch existed between the new gateway-minted lr1 and the old Vercel bridge, and that main@204e654 handles that same credential correctly.

It does NOT by itself prove that this compatibility mismatch was the original historical 08:59-09:01 incident. The original incident predated lr1.

### Final post-deployment pairing check

A second fresh A/B flow was run after both sides were deployed.

Observed:

- approval_required -> owner approval -> READY: 200;
- READY minted lr1;
- READY returned helper.nextUrl;
- instruction explicitly required replaying helper.nextUrl exactly;
- helper.nextUrl was replayed without rebuilding the credential URL;
- Tool Helper returned 200.

This validates the intended post-fix pairing contract.

### Legacy compatibility

A legacy o1.client credential continued to work through the updated gateway, including calls after gateway restart/recreate.

## 12. What is fixed vs what is still unknown

### Confirmed improved

- Raw client verification failures now have useful redacted diagnostics.
- Vercel and gateway requests can be correlated using trace IDs.
- READY can provide an exact next URL, reducing caller reconstruction.
- New pairings can use compact signed lr1 references.
- Registry remains authority for mutable client state.
- Legacy credentials remain compatible.
- Production Vercel and production gateway currently agree on lr1.
- Current live calls are green.

### Still not proven

- The exact original historical credential that produced the incident 401s.
- Whether the historical caller selected a stale credential.
- Whether the historical credential was truncated/mutated.
- Whether another rare caller state can still choose the wrong credential.
- Whether a long-running conversation can accumulate enough old client references to trigger a similar selection bug outside the new path.

Therefore status remains MITIGATED / NEEDS SOAK, not RESOLVED.

## 13. If 401 returns: first-response playbook

Do not immediately rotate keys, increase retries, restart everything, or force a new pairing. Preserve evidence first.

### Step 1 - classify the response

Capture:

- timestamp in UTC;
- Vercel deployment ID and commit SHA;
- action: tool-helper, context, fs, exec, job, output, etc.;
- HTTP status;
- response error and detail fields;
- traceId if present;
- whether credential class is legacy o1.client or lr1;
- credential length and fingerprint only, never the credential itself.

For a raw 401 agent_client_required / invalid, determine whether Vercel emitted client_guard_failure and whether gateway emitted client_verify_failure.

### Step 2 - correlate Vercel and gateway

Use traceId first.

Vercel-side useful events:

    operator_bridge
    client_guard_failure
    client_continuity_retry
    client_continuity_bypass
    client_continuity_exhausted
    client_continuity_recovered

Gateway-side useful event:

    client_verify_failure

Compare:

- traceId;
- fingerprint;
- credential length;
- decodeReason on Vercel;
- verifyReason on gateway;
- selected transport;
- deployment ID;
- action/path;
- attempt count.

If Vercel has a guard failure but gateway has no matching trace, the request may have failed before upstream verification.

If gateway has client_verify_failure, use verifyReason to distinguish shape/signature/json/expiry/scope/claim failures.

### Step 3 - determine whether registry was reached

A raw requireClient invalid means registry was not reached.

Registry-semantic failures should be investigated separately:

- agent_client_expired;
- closed/revoked session behavior;
- agent/account mismatch;
- device binding failures.

Do not mix registry failures with pre-registry cryptographic/structural failures.

### Step 4 - check deployment compatibility

Verify both sides before deeper investigation:

- Vercel production commit;
- gateway image ID/tag;
- effective docker compose config;
- no stale auth-file bind mount;
- both sides support the same credential class.

Known good Vercel commit from this incident:

    204e654

Known production gateway incident image:

    light-remote-gateway:fix401-204e654

Known compose protection:

    image: light-remote-gateway:fix401-204e654
    build: !reset null

A recurrence immediately after deployment should first be checked for a mixed-version window.

### Step 5 - compare same credential across actions

Without exposing the token, try to determine whether the same fingerprint succeeds/fails across:

- tool-helper;
- context;
- fs stat/read;
- job poll.

This incident showed that a freshly minted correct credential could work consistently across multiple actions. Later, the same lr1 credential produced 401 on old Vercel and 200 after Vercel was upgraded, which was highly diagnostic.

### Step 6 - inspect caller credential selection

If the credential is valid at the gateway but failures are intermittent, inspect whether the caller can hold multiple old client references and accidentally choose an older one.

Questions to answer:

- how many client credentials are present in the current agent/tool context?
- which fingerprint was selected for the failed request?
- was that fingerprint the latest READY credential?
- did helper.nextUrl exist and was it replayed exactly?
- was the URL rebuilt manually?
- was a previous conversation/session credential reused?

Never log raw values while answering these questions.

### Step 7 - inspect fan-out before adding retries

One bad logical invocation can create multiple requests. Count by trace/correlation rather than raw 401 volume.

Do not increase retry counts until the credential has been classified as structurally eligible and transient.

## 14. What not to do during a recurrence

Unless new evidence specifically points there, do NOT start with:

- rotating signing keys;
- replacing registry state;
- increasing continuity retry count;
- changing to cookie-only transport;
- accepting invalid credentials through fallback;
- automatically pairing a new client on generic 401;
- disabling signature checks;
- broad gateway upgrades that include unrelated release drift;
- deleting old images/backups before the issue is understood.

These actions either destroy evidence, broaden blast radius, or weaken auth.

## 15. Rollback notes

Vercel:

- baseline before this fix was main@75d3083;
- incident changes are 503fa97 and 204e654;
- if Vercel-only rollback is required, consider compatibility with the gateway credential being minted before moving aliases.

Gateway:

- production incident image is light-remote-gateway:fix401-204e654;
- the pre-fix rc.24 live image was retained/tagged during rollout as a rollback base;
- do not roll gateway back to a version that cannot understand lr1 while Vercel/READY continues minting lr1;
- coordinated rollback is required if removing clientRef support.

Compose:

- service directory: /home/ubuntu/services/lightbi-mcp-poc;
- backups of docker-compose.override.yml were created during the incident work;
- final override intentionally removes inherited build configuration and pins the tested image.

## 16. Files most relevant to future investigation

Vercel bridge:

    api/operator.js
    lib/operator.js
    lib/plus-client-continuity.cjs
    lib/plus-tool-helper.js

Gateway auth:

    gateway/plus-auth.mjs
    gateway/wall-auth.mjs
    gateway/server.mjs

Registry:

    operator-host/agent-client-registry.mjs

Tests:

    deploy/scripts/selftest-v11-client-continuity.mjs
    deploy/scripts/selftest-v11-client-diagnostics.mjs
    deploy/scripts/selftest-v09-client-resilience.mjs
    deploy/scripts/selftest-v09-plus-vercel-bridge.mjs
    deploy/scripts/selftest-v09-pairing-connect-flow.mjs
    deploy/scripts/selftest-v09-plus-auth.mjs

Gateway deployment helper:

    deploy/scripts/sync-gateway.sh

## 17. Decision record

Decisions intentionally made during this incident:

1. Keep auth fail-closed.
2. Preserve AgentClientRegistry as authority for mutable client state.
3. Add observability before guessing at a historical root cause.
4. Reduce model/caller token reconstruction with exact helper.nextUrl.
5. Introduce a shorter signed clientRef instead of relying on repeated transport of a long capability.
6. Keep legacy credential compatibility during migration.
7. Avoid cookie-only assumptions.
8. Avoid blind retry amplification.
9. Avoid rolling unrelated rc.25/rc.26 gateway drift into the incident fix.
10. Keep status as MITIGATED / NEEDS SOAK until production time provides stronger evidence.

## 18. Soak criteria before considering RESOLVED

Do not change this incident to RESOLVED solely because immediate pairing tests pass.

Suggested evidence for resolution:

- normal production usage over a meaningful period;
- no unexplained agent_client_required / invalid bursts;
- no repeated wrong-fingerprint selection from caller context;
- no client_continuity_bypass pattern caused by unexpected stale credentials;
- new A/B pairing continues to produce lr1 + exact helper.nextUrl + successful Tool Helper;
- legacy compatibility remains stable until intentionally retired;
- no mixed-version regressions after ordinary Vercel deploys or gateway/container recreates.

If any similar 401 returns, append a new dated section to this document instead of overwriting the original investigation trail.

## 19. Current checkpoint

As of 2026-09-25 after deployment:

- repository main: 204e654;
- Vercel production deployment for main@204e654: READY;
- production gateway: rc.24 base with minimal 401/clientRef overlay;
- production gateway image: light-remote-gateway:fix401-204e654;
- exact READY helper.nextUrl flow: observed 200;
- freshly minted lr1 Tool Helper: observed 200;
- real fs operation via lr1: observed 200;
- legacy o1.client path: observed working;
- current incident status: MITIGATED / NEEDS SOAK.

End of initial incident record.
