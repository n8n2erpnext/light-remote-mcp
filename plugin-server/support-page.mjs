import { WEB_FONT_FACE_CSS, WEB_UI_FONT, WEB_CODE_FONT } from '../lib/web-typography.mjs';

export function renderSupportPage({origin,version}){
  const canonical=`${origin}/support`;
  const faq=[
    ['Why does ChatGPT still ask for A/B approval after I signed in?','Account sign-in proves who you are. A/B approval separately authorizes one MCP client to one target device through that device\'s Local Wall.'],
    ['Can Light Remote switch to another device if the selected one is offline?','No. Light Remote requires an explicit target and does not silently fall back to another device.'],
    ['Why can I see the desktop but not click or type?','Real Remote input requires the target to advertise and locally permit the desktop-input capability in addition to any operating-system permissions.'],
    ['What happens when the Free tool-call quota is reached?','Further metered remote operations can be rejected until the quota resets or the account is upgraded. Account and support pages remain available.'],
    ['Should I send passwords or A/B continuation values to Support?','No. Do not send passwords, OTP or MFA codes, API keys, private keys, bearer tokens, A/B continuation values, or device secrets.']
  ];
  const faqJson=JSON.stringify({'@context':'https://schema.org','@type':'FAQPage','mainEntity':faq.map(([q,a])=>({'@type':'Question','name':q,'acceptedAnswer':{'@type':'Answer','text':a}}))}).replace(/</g,'\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Light Remote Support Center</title>
  <meta name="description" content="Install, connect, approve and troubleshoot Light Remote devices, Local Wall A/B approval, Real Remote, accounts, plans and updates.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="theme-color" content="#080a0c">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/account/assets/light-remote.ico" sizes="any">
  <meta property="og:type" content="website"><meta property="og:site_name" content="Light Remote">
  <meta property="og:title" content="Light Remote Support Center">
  <meta property="og:description" content="Guides and troubleshooting for Light Remote devices, approval, Real Remote, accounts and updates.">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${faqJson}</script>
  <style>
    ${WEB_FONT_FACE_CSS}
    :root{--bg:#080a0c;--panel:#0d1115;--panel2:#10161b;--line:#29313a;--text:#edf2f7;--muted:#8d99a6;--yellow:#ffcc00;--yellow-soft:#2a2409;--danger:#f79078}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:${WEB_UI_FONT};font-size:16px;line-height:1.6}a{color:inherit}
    .support-nav{max-width:1240px;margin:0 auto;padding:22px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid #171d23}
    .support-brand{display:flex;align-items:center;gap:10px;text-decoration:none}.support-brand img{width:34px;height:34px}.support-brand span{display:grid;line-height:1.15}.support-brand strong{font-size:15px}.support-brand small{font-size:11px;color:#778492}
    .support-nav nav{display:flex;gap:18px;align-items:center}.support-nav nav a{text-decoration:none;color:#9aa6b2;font-size:13px}.support-nav nav a:hover{color:#fff}
    .support-main{max-width:1240px;margin:0 auto;padding:58px 24px 80px}
    .support-hero{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);gap:42px;align-items:end;margin-bottom:42px}
    .eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--yellow);font-weight:700}.support-hero h1{font-size:48px;line-height:1.04;letter-spacing:-.045em;margin:10px 0 14px}.support-hero p{margin:0;color:#96a2af;font-size:17px;max-width:720px}
    .search-box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}.search-label{display:flex;align-items:center;gap:8px;color:#cfd7df;font-weight:700;font-size:13px;margin-bottom:10px}.search-label img{width:18px;filter:brightness(1.25)}
    .search-row{display:flex;gap:10px}.search-row input{width:100%;border:1px solid #303943;background:#080b0e;color:#fff;border-radius:11px;padding:13px 14px;font:inherit;outline:none}.search-row input:focus{border-color:#6f5d15;box-shadow:0 0 0 3px rgba(255,204,0,.07)}
    .search-note{margin-top:9px;color:#667482;font-size:11px}
    .quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:30px 0 50px}
    .quick-card{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:20px;text-decoration:none;display:grid;grid-template-columns:38px 1fr;gap:13px;align-items:start;transition:.15s ease}.quick-card:hover{transform:translateY(-2px);border-color:#5a4b18;background:#11150f}.quick-card img{width:28px;height:28px;padding:5px;border-radius:8px;background:#161c22}.quick-card strong{display:block;font-size:15px}.quick-card span{display:block;color:#83909d;font-size:12px;margin-top:3px}
    .support-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:30px;align-items:start}.support-side{position:sticky;top:20px;border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:15px}.support-side .label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#64717e;padding:5px 9px 10px}.support-side a{display:block;text-decoration:none;color:#8e9aa7;padding:9px 10px;border-radius:9px;font-size:13px}.support-side a:hover{background:#121820;color:#fff}
    .support-content{min-width:0}.support-section{scroll-margin-top:24px;border:1px solid var(--line);background:var(--panel);border-radius:18px;padding:28px;margin-bottom:18px}.support-section.hide{display:none}.support-section h2{font-size:24px;margin:0 0 8px;letter-spacing:-.025em}.support-section>p{color:#8c99a6;margin:0 0 20px}
    .steps{display:grid;gap:10px;counter-reset:step}.step{display:grid;grid-template-columns:31px 1fr;gap:12px;align-items:start;padding:12px 0;border-top:1px solid #20272e}.step:first-child{border-top:0}.step:before{counter-increment:step;content:counter(step);width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:var(--yellow);color:#111;font-size:12px;font-weight:800}.step strong{display:block}.step span{color:#85919e;font-size:13px}
    .callout{border:1px solid #493f18;background:#171508;border-radius:12px;padding:14px 16px;color:#cabb79;margin:16px 0}.callout strong{color:#ffe26a}.danger{border-color:#4a2b25;background:#180f0d;color:#d8aaa0}.danger strong{color:#ffb5a4}
    .support-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mini{border:1px solid #252d35;background:var(--panel2);border-radius:13px;padding:16px}.mini h3{font-size:14px;margin:0 0 8px}.mini p,.mini li{color:#84919e;font-size:13px}.mini p{margin:0}.mini ul{margin:8px 0 0;padding-left:18px}
    .error-table{width:100%;border-collapse:collapse;font-size:13px}.error-table th,.error-table td{border-top:1px solid #252d35;padding:12px 10px;text-align:left;vertical-align:top}.error-table th{color:#cbd4dd;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.error-table td{color:#84919e}.error-table code{font-family:${WEB_CODE_FONT};color:#f2d968;background:#16150d;padding:2px 5px;border-radius:5px}
    .diag{border:1px solid #303943;background:#090d10;border-radius:14px;padding:17px}.diag pre{white-space:pre-wrap;margin:12px 0 0;color:#aab4bf;font:12px/1.55 ${WEB_CODE_FONT};background:#060809;border:1px solid #20272e;border-radius:10px;padding:14px}.btn{border:1px solid #353e47;background:#11161b;color:#e7edf3;border-radius:10px;padding:10px 14px;font:600 13px ${WEB_UI_FONT};cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px}.btn:hover{border-color:#59636d;background:#151b21}.btn.primary{background:var(--yellow);border-color:var(--yellow);color:#111}.btn img{width:17px;height:17px}.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.contact-card{border:1px solid #2b333c;background:#0b1014;border-radius:14px;padding:18px}.contact-card h3{margin:0 0 6px;font-size:15px}.contact-card p{margin:0 0 14px;color:#84919e;font-size:13px}
    details{border-top:1px solid #252d35}details:first-of-type{border-top:0}summary{cursor:pointer;padding:15px 0;font-weight:700;color:#dce3e9}details p{margin:0 0 15px;color:#8793a0;font-size:13px}
    .no-results{display:none;border:1px dashed #38424c;border-radius:14px;padding:24px;text-align:center;color:#7f8b97;margin:18px 0}.no-results.show{display:block}
    .support-footer{margin-top:54px;border-top:1px solid #20262c;padding-top:24px;display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;color:#6f7b87;font-size:12px}.support-footer nav{display:flex;gap:14px;flex-wrap:wrap}.support-footer a{text-decoration:none;color:#84919e}.support-footer a:hover{color:#fff}
    @media(max-width:980px){.support-hero{grid-template-columns:1fr}.quick-grid{grid-template-columns:repeat(2,1fr)}.support-layout{grid-template-columns:1fr}.support-side{position:static;display:flex;overflow:auto;gap:4px}.support-side .label{display:none}.support-side a{white-space:nowrap}.support-cols,.contact-grid{grid-template-columns:1fr}}
    @media(max-width:620px){.support-main{padding:36px 16px 60px}.support-nav{padding:18px 16px}.support-nav nav a:not(:last-child){display:none}.support-hero h1{font-size:38px}.quick-grid{grid-template-columns:1fr}.support-section{padding:21px}.search-row{display:block}.support-cols{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header class="support-nav">
    <a class="support-brand" href="/"><img src="/account/assets/light-remote-mark.svg" alt=""><span><strong>Light Remote</strong><small>Support Center</small></span></a>
    <nav><a href="/downloads">Downloads</a><a href="/terms">Legal</a><a href="/">Product home</a></nav>
  </header>
  <main class="support-main">
    <section class="support-hero">
      <div><div class="eyebrow">LIGHT REMOTE SUPPORT</div><h1>Fix the exact layer that failed.</h1><p>Start with the symptom, then verify account, target device, Local Wall approval, capability policy, and transport in that order. Light Remote never silently switches you to another machine.</p></div>
      <div class="search-box">
        <label class="search-label" for="supportSearch"><img src="/assets/icons/material/search.svg" alt="">What are you trying to fix?</label>
        <div class="search-row"><input id="supportSearch" type="search" placeholder="Try: A code, device offline, mouse, quota, update…" autocomplete="off"></div>
        <div class="search-note">Search runs only in this page. Nothing you type here is sent to Support.</div>
      </div>
    </section>

    <section class="quick-grid" aria-label="Common support topics">
      <a class="quick-card" href="#getting-started"><img src="/assets/icons/material/download.svg" alt=""><div><strong>Install & link</strong><span>Get the client, link the device, then approve AI access.</span></div></a>
      <a class="quick-card" href="#approval"><img src="/assets/icons/material/link.svg" alt=""><div><strong>A/B approval</strong><span>Account sign-in is not device authorization.</span></div></a>
      <a class="quick-card" href="#real-remote"><img src="/assets/icons/material/computer.svg" alt=""><div><strong>Real Remote</strong><span>Screen works but mouse, keyboard, or permissions do not.</span></div></a>
      <a class="quick-card" href="#account-plans"><img src="/assets/icons/material/person.svg" alt=""><div><strong>Account & plans</strong><span>Login, password, quota, PRO, VIP and Fleet.</span></div></a>
      <a class="quick-card" href="#updates"><img src="/assets/icons/material/refresh.svg" alt=""><div><strong>Update problems</strong><span>Compatibility, prerelease warnings and recovery.</span></div></a>
      <a class="quick-card" href="#diagnostics"><img src="/assets/icons/material/support_agent.svg" alt=""><div><strong>Need human help</strong><span>Copy a safe support template and contact us.</span></div></a>
    </section>

    <div class="support-layout">
      <aside class="support-side">
        <div class="label">Support topics</div>
        <a href="#getting-started">Getting started</a>
        <a href="#approval">Connection & approval</a>
        <a href="#real-remote">Real Remote</a>
        <a href="#account-plans">Account & plans</a>
        <a href="#troubleshooting">Troubleshooting</a>
        <a href="#updates">Updates</a>
        <a href="#faq">FAQ</a>
        <a href="#diagnostics">Diagnostics & contact</a>
      </aside>
      <div class="support-content">
        <div id="noResults" class="no-results">No matching support section. Try a shorter symptom or copy the support template below.</div>

        <section id="getting-started" class="support-section" data-support="install setup link device windows linux macos download enrollment first run">
          <h2>Getting started</h2><p>There are two separate links to establish: device → account, then AI client → target device.</p>
          <div class="steps">
            <div class="step"><div><strong>Install the correct client</strong><span>Use <a href="/downloads">Downloads</a> for Windows, Linux desktop/server, or macOS. Keep the platform warning shown there in mind for unsigned prerelease builds.</span></div></div>
            <div class="step"><div><strong>Link the device to your account</strong><span>Use Add device in the account portal and complete the device enrollment flow. This creates an account-owned device identity.</span></div></div>
            <div class="step"><div><strong>Open Local Wall on that exact device</strong><span>Copy its one-time A code. An A code is short-lived and belongs to that device.</span></div></div>
            <div class="step"><div><strong>Approve the AI client locally</strong><span>The Light Remote helper turns A into a B approval request. Enter B at the same Local Wall and choose Approve, then let the helper continue.</span></div></div>
          </div>
          <div class="callout"><strong>Account login ≠ device authorization.</strong> Google/email sign-in proves the account identity; Local Wall A/B approval grants one client access to one target device.</div>
        </section>

        <section id="approval" class="support-section" data-support="a code b code approval required pairing helper local wall offline target session continuation device access">
          <h2>Connection & A/B approval</h2><p>When connection fails, preserve the target device and check the trust chain instead of pairing another machine.</p>
          <div class="support-cols">
            <div class="mini"><h3>If the helper asks for an A code</h3><ul><li>Open Local Wall on the target device.</li><li>Generate a fresh A code.</li><li>Submit it before it expires.</li><li>Show only the returned B code to the owner.</li></ul></div>
            <div class="mini"><h3>If approval was already granted</h3><ul><li>Confirm the same account is signed in.</li><li>Confirm the same target device is online.</li><li>Resume the existing helper/session when possible.</li><li>Do not silently choose a different device.</li></ul></div>
          </div>
          <div class="danger callout"><strong>Never send to Support:</strong> A/B continuation payloads, session capabilities, bearer tokens, account cookies, passwords, OTP/MFA codes, private keys, API keys, or device secrets.</div>
        </section>

        <section id="real-remote" class="support-section" data-support="real remote screen screenshot mouse keyboard click input desktop live semantic permission accessibility capture cursor">
          <h2>Real Remote</h2><p>Observation and physical input are separate capabilities. Seeing the desktop does not automatically authorize clicks or typing.</p>
          <div class="support-cols">
            <div class="mini"><h3>Screen or semantic view missing</h3><ul><li>Confirm the device is online and still the active target.</li><li>Confirm desktop observation is advertised by the device.</li><li>Check operating-system screen-capture permissions.</li><li>Use a full frame only for bootstrap/resync; prefer the live semantic lane during normal work.</li></ul></div>
            <div class="mini"><h3>Mouse or keyboard blocked</h3><ul><li>Confirm <code>desktop-input</code> is an effective capability.</li><li>Check device-local policy and OS accessibility/input permissions.</li><li>Reconnect after changing OS permissions when the platform requires it.</li><li>A policy denial is not an instruction to bypass the policy.</li></ul></div>
          </div>
        </section>

        <section id="account-plans" class="support-section" data-support="account login google email password free pro vip fleet quota 10000 unlimited billing upgrade plan">
          <h2>Account & plans</h2><p>Account problems and remote-device problems are different layers. Resolve sign-in first, then device access.</p>
          <div class="support-cols">
            <div class="mini"><h3>Sign-in</h3><p>Use the account method already attached to your Light Remote identity. Google-authenticated accounts can set an account password when needed for Local Wall or desktop-client sign-in.</p></div>
            <div class="mini"><h3>Plans</h3><p>Free currently includes 10,000 metered tool calls per month. PRO and VIP remove that tool-call limit; Fleet features require an eligible entitlement and compatible Main device.</p></div>
          </div>
          <div class="callout"><strong>Quota reached?</strong> A metered remote call can be rejected with <code>tool_call_quota_exceeded</code>. Wait for the quota reset or upgrade the account; repeatedly retrying will not bypass the limit.</div>
        </section>
        <section id="troubleshooting" class="support-section" data-support="error troubleshooting denied unavailable timeout quota offline compatibility update required capability missing policy error code">
          <h2>Troubleshooting by symptom</h2><p>Use the exact error text when you have it. These mappings tell you which layer to inspect first.</p>
          <div style="overflow:auto"><table class="error-table">
            <thead><tr><th>Symptom</th><th>Check first</th><th>What not to do</th></tr></thead>
            <tbody>
              <tr><td><code>approval_required</code> or helper requests A</td><td>Open Local Wall on the intended device and start a fresh A/B approval flow.</td><td>Do not enumerate or pair unrelated devices.</td></tr>
              <tr><td>Device offline / unreachable</td><td>Confirm the device agent is running, the device is online, and the target identity is unchanged.</td><td>Do not silently fall back to another machine.</td></tr>
              <tr><td>Policy denied / capability missing</td><td>Inspect effective capabilities and device-local policy; verify OS permissions where relevant.</td><td>Do not bypass the policy or invent a capability.</td></tr>
              <tr><td><code>tool_call_quota_exceeded</code></td><td>Check Usage and the account plan.</td><td>Do not retry in a loop to evade quota enforcement.</td></tr>
              <tr><td>Client/server update required</td><td>Check the compatibility status in Account → Devices and update the indicated side.</td><td>Do not force an incompatible device into Main/Fleet.</td></tr>
              <tr><td>Timeout or transient transport error</td><td>Retry the same bounded operation or recover its durable state/output.</td><td>Do not repeat a consequential action if it may already be running.</td></tr>
            </tbody>
          </table></div>
        </section>

        <section id="updates" class="support-section" data-support="update updater version rc33 beta prerelease unsigned notarized macos windows linux rollback compatibility">
          <h2>Updates & compatibility</h2><p>Light Remote uses compatibility checks and health-gated recovery so a bad update does not need to become a permanent outage.</p>
          <div class="support-cols">
            <div class="mini"><h3>Before updating</h3><ul><li>Check the platform and architecture.</li><li>Keep the device online during the update.</li><li>Review prerelease or unsigned warnings shown by the platform.</li><li>Do not remove a working installation before confirming the new package is healthy.</li></ul></div>
            <div class="mini"><h3>After updating</h3><ul><li>Verify the Core/client version in Account → Devices.</li><li>Confirm the device comes back online.</li><li>Re-check Local Wall only if the trust state actually changed.</li><li>Use the existing session/job state when it remains valid.</li></ul></div>
          </div>
          <div class="callout"><strong>macOS prerelease note:</strong> the current prerelease packages may be unsigned/not notarized. Follow the warning and instructions shown on the Downloads page; do not disable platform security globally.</div>
        </section>

        <section id="faq" class="support-section" data-support="faq questions signin approval fallback input quota secrets security">
          <h2>Frequently asked questions</h2><p>Short answers to the issues that most often look like bugs but are actually trust or policy boundaries.</p>
          ${faq.map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('')}
        </section>

        <section id="diagnostics" class="support-section" data-support="diagnostics support contact email github issue bug report logs template browser version error">
          <h2>Diagnostics & contact</h2><p>Send enough context to reproduce the problem, but keep secrets and approval material out of the report.</p>
          <div class="diag">
            <div><strong>Safe support template</strong> <span style="color:#74808c;font-size:12px">— generated locally in your browser</span></div>
            <pre id="diagText">Loading safe template…</pre>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
              <button id="copyDiag" class="btn primary" type="button"><img src="/assets/icons/material/content_copy.svg" alt="">Copy support template</button>
              <a class="btn" href="/account"><img src="/assets/icons/material/settings.svg" alt="">Open account</a>
            </div>
          </div>
          <div class="danger callout"><strong>Redact before sending.</strong> Never include passwords, OTP/MFA codes, bearer/API tokens, cookies, private keys, A/B continuation data, device secrets, or screenshots containing sensitive credentials.</div>
          <div class="contact-grid">
            <div class="contact-card"><h3>Private account / billing / security issue</h3><p>Email Support when the report contains account identity, entitlement, or non-public operational details.</p><a class="btn" href="mailto:support@thaiduy.digital?subject=Light%20Remote%20Support">support@thaiduy.digital</a></div>
            <div class="contact-card"><h3>Public reproducible bug</h3><p>For bugs safe to discuss publicly, include minimal reproduction steps, platform, version, and sanitized error output.</p><a class="btn" href="https://github.com/n8n2erpnext/light-remote-mcp/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a></div>
          </div>
        </section>
      </div>
    </div>

    <footer class="support-footer">
      <span>Light Remote ${version} · thaiduy.digital</span>
      <nav><a href="/downloads">Downloads</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a><a href="/">Home</a></nav>
    </footer>
  </main>
  <script>
  (()=> {
    const input=document.getElementById('supportSearch');
    const sections=[...document.querySelectorAll('.support-section')];
    const empty=document.getElementById('noResults');
    input?.addEventListener('input',()=>{
      const q=String(input.value||'').trim().toLowerCase();
      let shown=0;
      for(const section of sections){
        const hay=(section.dataset.support+' '+section.textContent).toLowerCase();
        const show=!q||q.split(/\s+/).every(term=>hay.includes(term));
        section.classList.toggle('hide',!show);
        if(show)shown++;
      }
      empty.classList.toggle('show',Boolean(q)&&shown===0);
    });

    const diag=document.getElementById('diagText');
    const button=document.getElementById('copyDiag');
    const safePlatform=()=>navigator.userAgentData?.platform||navigator.platform||'unknown';
    const build=async()=>{
      let health={};
      try{health=await (await fetch('/healthz',{cache:'no-store'})).json();}catch{}
      return [
        'Light Remote support report',
        'Server/Core: '+String(health.version||'${version}'),
        'MCP surface: '+String(health.mcpSurfaceVersion||'unknown'),
        'Browser platform: '+safePlatform(),
        'Browser: '+navigator.userAgent,
        '',
        'Problem area: [install / approval / remote / account / update / other]',
        'Target device OS/arch: [fill in]',
        'Target client/Core version: [fill in]',
        'Device status: [online / offline / unknown]',
        'Exact sanitized error: [paste here]',
        'What happened just before it failed: [brief steps]',
        'Expected result: [fill in]',
        '',
        'REDACTED: passwords, MFA/OTP, tokens, cookies, private keys, A/B continuation, device secrets'
      ].join('\n');
    };
    build().then(t=>{if(diag)diag.textContent=t;});
    button?.addEventListener('click',async()=>{
      const text=await build();
      try{await navigator.clipboard.writeText(text);button.textContent='Copied';setTimeout(()=>button.innerHTML='<img src="/assets/icons/material/content_copy.svg" alt="">Copy support template',1600);}
      catch{diag.textContent=text;button.textContent='Select and copy';}
    });
  })();
  </script>
</body></html>`;
}
