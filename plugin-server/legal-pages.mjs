import { WEB_FONT_FACE_CSS, WEB_UI_FONT } from '../lib/web-typography.mjs';

const UPDATED='October 6, 2026';

const NAV=Object.freeze([
  ['terms','/terms','Terms of Service'],
  ['privacy','/privacy','Privacy Policy'],
  ['cookies','/cookies','Cookie Policy']
]);

function legalNav(active){
  return NAV.map(([id,href,label])=>`<a class="${active===id?'active':''}" href="${href}">${label}</a>`).join('');
}

export function renderLegalPage({active,title,description,body,origin}){
  const canonical=`${origin}/${active}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | Light Remote Legal</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="theme-color" content="#f3f5f7">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/account/assets/light-remote.ico" sizes="any">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Light Remote">
  <meta property="og:title" content="${title} | Light Remote Legal">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary">
  <style>
    ${WEB_FONT_FACE_CSS}
    :root{--bg:#f3f5f7;--paper:#fff;--line:#e2e7ec;--text:#1b2430;--muted:#667085;--brand:#f5c400;--brand-dark:#5f4b00;--side:#fff;--link:#2557c7}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;background:var(--bg);color:var(--text);font-family:${WEB_UI_FONT};font-size:16px;line-height:1.68}
    a{color:var(--link)}
    .legal-top{height:70px;background:#0a0d10;color:#f7f8fa;display:flex;align-items:center;border-bottom:1px solid #242a31;position:sticky;top:0;z-index:5}
    .legal-top-inner{width:min(1380px,100%);margin:auto;padding:0 28px;display:flex;align-items:center;justify-content:space-between;gap:20px}
    .legal-brand{display:flex;align-items:center;gap:11px;color:inherit;text-decoration:none;font-weight:700}
    .legal-brand img{width:31px;height:31px}
    .legal-brand small{display:block;color:#8f9aa6;font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase}
    .legal-top nav{display:flex;align-items:center;gap:18px;font-size:13px}
    .legal-top nav a{color:#b7c0ca;text-decoration:none}.legal-top nav a:hover{color:#fff}
    .legal-shell{width:min(1380px,100%);margin:0 auto;display:grid;grid-template-columns:260px minmax(0,1fr);min-height:calc(100vh - 70px)}
    .legal-side{background:var(--side);border-right:1px solid var(--line);padding:38px 24px;position:relative}
    .legal-side-inner{position:sticky;top:108px;display:grid;gap:8px}
    .legal-side-title{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#98a2b3;margin:0 10px 8px}
    .legal-side a{display:block;padding:10px 12px;border-radius:10px;color:#344054;text-decoration:none;font-size:14px}
    .legal-side a:hover{background:#f7f8fa;color:#111827}
    .legal-side a.active{background:#fff8d9;color:#3d3100;font-weight:700;box-shadow:inset 3px 0 0 var(--brand)}
    .legal-side .split{height:1px;background:var(--line);margin:16px 10px}
    .legal-main{padding:56px 54px 90px}
    .legal-card{width:min(820px,100%);margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:0 8px 30px rgba(15,23,42,.04);padding:54px 58px}
    .legal-card h1{font-size:36px;line-height:1.15;letter-spacing:-.035em;margin:0 0 18px}
    .legal-card h2{font-size:24px;line-height:1.25;letter-spacing:-.02em;margin:42px 0 14px;padding-top:4px}
    .legal-card h3{font-size:17px;line-height:1.35;margin:26px 0 8px}
    .legal-card p{margin:0 0 17px;color:#475467}
    .legal-card ul{margin:10px 0 18px;padding-left:22px;color:#475467}.legal-card li{margin:8px 0}
    .legal-card hr{border:0;border-top:1px solid var(--line);margin:34px 0}
    .legal-card strong{color:#253040}
    .updated{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:15px 0;margin:22px 0 30px;color:#475467;font-size:14px}
    .notice{border:1px solid #ead87f;background:#fffbea;border-radius:12px;padding:16px 18px;margin:20px 0;color:#5d4a00}
    .legal-table-wrap{overflow:auto;margin:18px 0 24px}
    table{border-collapse:collapse;width:100%;min-width:620px;font-size:14px}th,td{border:1px solid var(--line);padding:12px 14px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#344054}td{color:#475467}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f4f6f8;padding:2px 5px;border-radius:5px;font-size:.92em}
    .doc-foot{margin-top:48px;padding-top:24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;color:#7a8694;font-size:13px}.doc-foot a{color:#52606f}
    @media(max-width:900px){.legal-shell{grid-template-columns:1fr}.legal-side{border-right:0;border-bottom:1px solid var(--line);padding:14px 18px;overflow:auto}.legal-side-inner{position:static;display:flex;gap:6px;min-width:max-content}.legal-side-title,.legal-side .split,.legal-side .product-link{display:none}.legal-side a{white-space:nowrap}.legal-main{padding:26px 16px 60px}.legal-card{padding:34px 26px}.legal-card h1{font-size:30px}}
    @media(max-width:560px){.legal-top{height:62px}.legal-top-inner{padding:0 16px}.legal-top nav a:not(:last-child){display:none}.legal-card{padding:28px 20px;border-radius:14px}.legal-card h1{font-size:28px}.legal-card h2{font-size:21px}}
  </style>
</head>
<body>
  <header class="legal-top"><div class="legal-top-inner">
    <a class="legal-brand" href="/"><img src="/account/assets/light-remote-mark.svg" alt=""><span>Light Remote<small>Legal Center</small></span></a>
    <nav><a href="/downloads">Downloads</a><a href="/support">Support</a><a href="/">Product home</a></nav>
  </div></header>
  <div class="legal-shell">
    <aside class="legal-side"><div class="legal-side-inner">
      <div class="legal-side-title">Legal documents</div>
      ${legalNav(active)}
      <div class="split"></div>
      <div class="legal-side-title">Product</div>
      <a class="product-link" href="/support">Support</a>
      <a class="product-link" href="/downloads">Downloads</a>
      <a class="product-link" href="/">Light Remote</a>
    </div></aside>
    <main class="legal-main"><article class="legal-card">
      ${body}
      <footer class="doc-foot"><span>Light Remote · thaiduy.digital</span><span><a href="mailto:support@thaiduy.digital">support@thaiduy.digital</a></span></footer>
    </article></main>
  </div>
</body></html>`;
}

export const LEGAL_PAGES=Object.freeze({
  terms:{
    title:'Terms of Service',
    description:'Terms governing access to and use of Light Remote, including remote actions, device authorization, account plans and prerelease software.',
    body:`<h1>Terms of Service</h1>
<p class="updated"><strong>Last updated:</strong> ${UPDATED}</p>
<p>These Terms of Service ("Terms") govern access to and use of Light Remote, including the hosted service at <code>light-remote.thaiduy.digital</code>, account and device services, desktop/server software, the official MCP/plugin surface, documentation, downloads, and related features (collectively, the "Service"). Light Remote is part of the thaiduy.digital product ecosystem.</p>
<p>By creating an account, installing Light Remote, connecting a device, or using the Service, you agree to these Terms. If you use the Service for an organization, you represent that you are authorized to do so for that organization.</p>
<div class="notice"><strong>Important:</strong> Light Remote can execute commands, edit files, control applications, transfer data, and perform other actions on connected systems. Use it only on devices, accounts, services, repositories, and networks you own or are authorized to operate.</div>

<h2>1. What Light Remote provides</h2>
<p>Light Remote is a governed remote-computing and MCP control plane for explicitly authorized devices. Depending on the client, platform, plan, device policy, and installed components, features may include filesystem access, search, managed processes, terminals, file transfer, device management, and Real Remote observation or input.</p>
<p>The Service does not make every connected device or capability automatically available. Account authorization, A/B client-to-device approval, operating-system permissions, device-local policy, capability advertisement, and plan entitlements may all narrow what can be used.</p>

<h2>2. Eligibility and accounts</h2>
<p>You must be legally capable of entering into these Terms. You must provide accurate account information and protect your sign-in methods. You are responsible for activity performed through your account unless applicable law provides otherwise.</p>
<p>If you suspect unauthorized account or device access, revoke affected sessions or devices where available and contact Support promptly.</p>

<h2>3. Devices, Local Wall, and authorization</h2>
<p>You may connect only devices you own or have clear permission to administer. Device enrollment and AI-client access are separate trust decisions.</p>
<ul>
<li>Enrollment links a device identity to an account.</li>
<li>Local Wall A/B approval authorizes a specific client to a specific target device.</li>
<li>Device-local policy remains a final deny boundary and may reject an operation even when the account or server would otherwise allow it.</li>
</ul>
<p>You may not bypass, weaken, forge, replay, or deliberately circumvent approval, policy, capability, or security controls.</p>

<h2>4. Acceptable use</h2>
<p>You must not use Light Remote to:</p>
<ul>
<li>access or control systems without authorization;</li>
<li>steal credentials, private keys, tokens, personal data, or other protected information;</li>
<li>deploy malware, destructive payloads, or persistence intended to evade an owner or administrator;</li>
<li>defeat security controls, rate limits, or plan restrictions through deception or technical circumvention;</li>
<li>violate applicable law or the rights of another person or organization; or</li>
<li>misrepresent ownership or authorization over a connected device or account.</li>
</ul>
<p>Security testing is permitted only when you are authorized to test the relevant target.</p>

<h2>5. Remote actions and AI-generated instructions</h2>
<p>Remote operations can cause real-world changes. You are responsible for reviewing consequential actions, maintaining appropriate backups, and confirming that the target and intended effect are correct.</p>
<p>AI clients and models may misunderstand instructions, produce incomplete plans, or suggest incorrect commands. Light Remote provides transport, policy, approval, and execution mechanisms; it does not guarantee the correctness of instructions generated by third-party AI systems.</p>
<p>Where durable jobs, terminals, transfers, or sessions already exist, clients should recover existing state where practical instead of blindly repeating consequential actions.</p>

<h2>6. Your content and remote task data</h2>
<p>You retain the rights you have in files, prompts, commands, screenshots, terminal content, outputs, and other data you provide or access through the Service ("Your Content"). You grant Light Remote only the rights reasonably necessary to transmit, process, secure, and operate the Service for you.</p>
<p>You are responsible for ensuring that you have permission to process Your Content and that your use of it complies with applicable law and third-party rights.</p>

<h2>7. Credentials and restricted secrets</h2>
<p>Remote tools are not designed to collect or expose passwords, MFA or OTP codes, private keys, bearer tokens, API keys, full payment-card data, or similar secrets. Keep credentials in device-local credential stores whenever possible. Do not intentionally route protected secrets through remote tool results.</p>

<h2>8. Plans, quotas, and entitlements</h2>
<p>Light Remote may offer Free, PRO, VIP, Fleet, trial, beta, promotional, or other entitlements. Current features, quotas, and plan availability are shown in the Service and may change prospectively.</p>
<p>Paid or managed entitlements may be granted through a purchase flow, an approved upgrade request, a license or VIP key, or another method shown in your account. If a payment is collected, the price, billing period, renewal behavior, and any specific cancellation or refund terms will be presented before purchase. Light Remote will not treat a plan as automatically renewing unless that is disclosed and accepted in the applicable purchase flow.</p>
<p>Quotas may be enforced at account, device, tool, transfer, or other service boundaries. We may reject requests that exceed an applicable quota or entitlement.</p>

<h2>9. Beta, prerelease, and unsigned software</h2>
<p>Some Light Remote software and features may be labeled beta, preview, RC, prerelease, experimental, or unsigned. They may change, contain bugs, or be discontinued. Installers or operating systems may display additional warnings for unsigned prerelease builds. Review those warnings before proceeding.</p>

<h2>10. Third-party services</h2>
<p>Light Remote can interoperate with third-party services such as AI clients, identity providers, code hosting, infrastructure, email delivery, and distribution services. Your use of those third-party services is also subject to their own terms and privacy practices.</p>

<h2>11. Ownership, software, and open-source components</h2>
<p>Light Remote and its non-open-source service components, branding, documentation, and hosted interfaces are protected by applicable intellectual-property laws. Open-source components are governed by their respective licenses, which control to the extent they grant rights not stated in these Terms.</p>
<p>If you submit feedback, you permit us to use it to improve the Service without an obligation to compensate you.</p>

<h2>12. Availability, security, and service changes</h2>
<p>We may change, suspend, rate-limit, or discontinue features for maintenance, security, abuse prevention, compatibility, legal compliance, or product development. We will use reasonable efforts to avoid unnecessary disruption to paid functionality.</p>
<p>No internet-connected service can be guaranteed to be uninterrupted or error-free. Keep independent backups of important data and configuration.</p>

<h2>13. Suspension and termination</h2>
<p>You may stop using the Service at any time and may use available account controls to remove devices or end sessions. We may suspend or terminate access when reasonably necessary to address fraud, abuse, unauthorized access, material breach of these Terms, security risk, non-payment where applicable, or legal requirements.</p>
<p>Where practical and legally permitted, we will provide notice and an opportunity to resolve a remediable issue before terminating an account for ordinary breach. Immediate action may be necessary for active abuse or security threats.</p>

<h2>14. Disclaimers</h2>
<p>To the extent permitted by applicable law, the Service is provided "as is" and "as available." We do not promise that every device, operating system, AI client, integration, or third-party service will remain compatible. Nothing in these Terms excludes warranties or remedies that cannot lawfully be excluded.</p>

<h2>15. Limitation of liability</h2>
<p>To the extent permitted by applicable law, Light Remote and the operator of thaiduy.digital will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising from use of the Service. Any limitation applies only to the extent allowed by law and does not exclude liability that cannot legally be limited.</p>

<h2>16. Changes to these Terms</h2>
<p>We may update these Terms as the Service changes. Material changes will be identified by an updated date and, where appropriate or required, additional notice through the Service or account email. Continued use after an effective update constitutes acceptance to the extent permitted by law.</p>

<h2>17. General terms and contact</h2>
<p>If a provision of these Terms is unenforceable, the remaining provisions remain in effect. These Terms do not reduce mandatory consumer, privacy, employment, or other rights that apply to you.</p>
<p>Questions about these Terms can be sent to <a href="mailto:support@thaiduy.digital">support@thaiduy.digital</a>.</p>`
  },
  privacy:{
    title:'Privacy Policy',
    description:'How Light Remote handles account information, device metadata, remote task data, usage records, support data and user controls.',
    body:`<h1>Privacy Policy</h1>
<p class="updated"><strong>Last updated:</strong> ${UPDATED}</p>
<p>This Privacy Policy explains how Light Remote handles information when you use the hosted service, account portal, device software, official plugin/MCP surface, downloads, and related services. Light Remote is part of the thaiduy.digital product ecosystem.</p>
<p>This policy describes Light Remote's own processing. Third-party AI clients, identity providers, infrastructure services, code hosts, and other integrations have their own privacy practices.</p>

<h2>1. Scope</h2>
<p>Light Remote is designed to connect an authenticated AI client to an explicitly authorized user-owned device. The hosted service does not expand the access granted by that device, its operating system, or its Local Wall policy.</p>

<h2>2. Data used to provide the service</h2>
<p>Depending on how you use Light Remote, we may process the following categories:</p>
<ul>
<li><strong>Account data:</strong> email address, authentication provider, verification state, account status, plan, entitlements, and security events.</li>
<li><strong>Device data:</strong> device identity, display name, platform, architecture, software version, capabilities, connection state, last-seen time, Main/Fleet role, and policy or compatibility metadata.</li>
<li><strong>Authorization and session data:</strong> client-to-device approvals, session identifiers, target-device references, grants, leases, operation identifiers, and recovery state.</li>
<li><strong>Remote task data:</strong> data required for an operation, which may include file paths or content, search terms, command input, terminal input/output, transfer chunks, process state, and bounded Real Remote semantic or visual state.</li>
<li><strong>Usage and diagnostics:</strong> tool-call counts, connected device-hours, timestamps, error categories, compatibility information, service health, security events, and diagnostic logs.</li>
<li><strong>Support and communication data:</strong> information you send when requesting support, account help, upgrades, or other assistance.</li>
</ul>

<h2>3. Purpose and sharing</h2>
<p>We use information to authenticate users, link and route work to the intended device, enforce policy and entitlements, recover durable operations, provide account and activity views, prevent abuse, troubleshoot failures, distribute updates, communicate about the Service, and comply with legal obligations.</p>
<p>We do not sell personal data or use remote task content for behavioral advertising. Light Remote does not train a general-purpose AI model on your remote task content.</p>

<h2>4. Remote task data</h2>
<p>Remote task data is processed because the requested operation cannot be performed without moving the necessary instruction or result between the selected client and device. We aim to minimize what is transmitted and to keep credential material out of remote responses.</p>
<p>Some task data may exist transiently in memory, request buffers, transport layers, or security/diagnostic logs. Durable jobs, transfers, terminals, sessions, or Real Remote state may retain the minimum operational metadata needed for continuation, recovery, or policy enforcement.</p>
<p>Light Remote is not intended as a general cloud-storage service. Keep authoritative copies of files and important state on systems you control.</p>

<h2>5. Restricted secrets</h2>
<p>Remote tools are not intended to collect passwords, MFA or OTP codes, private keys, bearer tokens, API keys, full payment-card data, government identifiers, or protected health information. Response sanitization and policy controls are used to reduce accidental exposure, but users remain responsible for avoiding unnecessary secret handling.</p>

<h2>6. Authentication and account cookies</h2>
<p>Light Remote uses strictly necessary account cookies for sign-in, verified registration flows, and short-lived pending actions. Theme preference is stored locally in the browser. See the <a href="/cookies">Cookie Policy</a> for details.</p>

<h2>7. Third-party services</h2>
<p>When you choose to use a third-party service, information may be exchanged with that provider as necessary for the feature. Examples include:</p>
<ul>
<li>an AI client or model provider that sends remote-tool requests and receives results;</li>
<li>an identity provider used for sign-in;</li>
<li>email and infrastructure providers used to deliver transactional messages and host the Service;</li>
<li>code hosting or release distribution providers used to publish software; and</li>
<li>other integrations you explicitly enable.</li>
</ul>
<p>Those providers process data under their own terms and privacy policies. Light Remote does not control how a third-party AI service uses information after it leaves Light Remote and is received by that provider.</p>

<h2>8. Retention and controls</h2>
<p>We retain information only for as long as reasonably needed for the purpose for which it is processed, security, recovery, account operation, dispute handling, or legal compliance. Different records have different lifecycles:</p>
<ul>
<li>account records generally remain while the account is active and for a limited period after closure where needed for recovery, security, or legal obligations;</li>
<li>device records remain until removed, revoked, or otherwise cleaned up under account lifecycle rules;</li>
<li>short-lived approval and registration artifacts expire automatically;</li>
<li>durable session or operation state remains only while needed to continue, recover, audit, or safely close the operation; and</li>
<li>usage, security, and diagnostic records may be retained longer than transient task data because they are used for quotas, abuse prevention, service integrity, and troubleshooting.</li>
</ul>
<p>You can remove or revoke devices, close sessions, stop managed processes or terminals, and use available account controls to reduce retained operational state.</p>

<h2>9. Account inactivity and deletion</h2>
<p>Free accounts may enter an inactive or dormant state after an extended period without use, as shown in the Service. Dormancy is not the same as immediate deletion. Where account deletion is available or requested, we will remove or de-identify information that is no longer required, subject to security, backup, fraud-prevention, and legal retention needs.</p>

<h2>10. Security</h2>
<p>Light Remote uses layered controls including authenticated accounts, explicit device targeting, Local Wall A/B approval, device-local final policy, scoped sessions, restricted secrets, service hardening, and signed or health-gated update mechanisms where supported.</p>
<p>No security measure can guarantee absolute protection. You are responsible for securing your own devices, operating systems, local accounts, networks, and third-party AI accounts.</p>

<h2>11. Your choices and privacy rights</h2>
<p>Depending on applicable law, you may have rights to access, correct, delete, restrict, object to, or obtain a copy of certain personal data. You can also revoke devices and sessions through available product controls.</p>
<p>To make a privacy request, contact <a href="mailto:support@thaiduy.digital">support@thaiduy.digital</a>. We may need to verify your identity before acting on a request.</p>

<h2>12. International processing</h2>
<p>Internet services may process information in more than one country because infrastructure and third-party providers can operate globally. Where applicable law requires safeguards for international transfers, we will use measures appropriate to the relevant processing.</p>

<h2>13. Children</h2>
<p>Light Remote is a technical remote-computing product and is not directed to children. Do not create an account if you are not legally permitted to enter into the applicable agreement in your jurisdiction.</p>

<h2>14. Changes to this policy</h2>
<p>We may update this policy when the Service, legal requirements, or data practices change. The updated date above indicates the current version. Material changes will receive additional notice where appropriate or required.</p>

<h2>15. Contact</h2>
<p>Privacy questions and requests can be sent to <a href="mailto:support@thaiduy.digital">support@thaiduy.digital</a>.</p>`
  },
  cookies:{
    title:'Cookie Policy',
    description:'Information about the essential cookies and local browser storage used by Light Remote for account security and preferences.',
    body:`<h1>Cookie Policy</h1>
<p class="updated"><strong>Last updated:</strong> ${UPDATED}</p>
<p>This Cookie Policy explains the cookies and similar browser storage used by Light Remote. It should be read together with the <a href="/privacy">Privacy Policy</a>.</p>

<h2>1. What we use</h2>
<p>Light Remote currently uses a small set of strictly necessary cookies for account security and registration workflows. It also stores the selected light/dark theme in browser local storage.</p>
<p>We do not currently use advertising cookies or third-party behavioral tracking cookies on the Light Remote product and account pages.</p>

<h2>2. Essential cookies</h2>
<div class="legal-table-wrap"><table>
<thead><tr><th>Name</th><th>Purpose</th><th>Typical lifetime</th></tr></thead>
<tbody>
<tr><td><code>__Host-light_remote_account</code></td><td>Authenticates the signed-in Light Remote account session. It is marked Secure, HttpOnly, SameSite=Strict, and scoped to the host.</td><td>For the authenticated session, until expiry or sign-out.</td></tr>
<tr><td><code>__Host-light_remote_google_signup</code></td><td>Temporarily connects a verified Google sign-in result to the Light Remote registration flow.</td><td>Short-lived; removed when the flow completes or expires.</td></tr>
<tr><td><code>__Host-light_remote_pending</code></td><td>Tracks a short-lived pending registration or verification flow without exposing the underlying internal identifier to page scripts.</td><td>Short-lived; removed when the flow completes or expires.</td></tr>
</tbody></table></div>

<h2>3. Local storage</h2>
<p>Light Remote may store <code>light-remote-theme</code> in your browser's local storage to remember whether you selected light or dark appearance. This preference is stored on the browser and is not an authentication credential.</p>

<h2>4. Third-party services</h2>
<p>If you leave Light Remote to sign in with or use a third-party provider, that provider may set its own cookies on its own domain. Those cookies are controlled by the third party and are governed by its privacy and cookie practices.</p>

<h2>5. Managing cookies</h2>
<p>Most browsers let you inspect, block, or delete cookies and local storage. Blocking Light Remote's essential cookies can prevent account registration, sign-in, account management, or security workflows from functioning correctly.</p>

<h2>6. Consent and future changes</h2>
<p>Because the cookies described above are used for essential security or user-requested functionality, Light Remote does not currently present a marketing-cookie consent banner. If non-essential analytics, advertising, or similar cookies are introduced later, this policy will be updated and consent controls will be added where required by applicable law.</p>

<h2>7. Contact</h2>
<p>Questions about cookies or browser storage can be sent to <a href="mailto:support@thaiduy.digital">support@thaiduy.digital</a>.</p>`
  }
});
