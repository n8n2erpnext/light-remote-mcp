// Native Local Wall A/B V2 approval UI, shared by Windows/macOS/Linux.
 // Only rendered after authenticated local Owner; never generates A/B.
// Signed Operator preview; human B + authenticated Owner mandatory. Outside the isolated Lab, an independent Owner consent is additionally required.
export const wallAbV2PreviewFragment = `
<section id="abV2OwnerPreview" hidden class="card ab2-shell" aria-label="A/B V2 Agent approval">
 <style>
 /* Use the SAME native .wrap / .card / .btn / .primary tokens as V1 Wall.
    Only layout utilities are scoped here; no second blue theme or overlay. */
 .ab2-shell{margin-top:18px}
 .ab2-shell .ab2-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
 .ab2-shell h2{font-size:18px;line-height:1.35;margin:0 0 5px;color:#e7edf4}
 .ab2-shell h3{font-size:14px;line-height:1.45;margin:0;color:#d8dee7}
 .ab2-shell .ab2-muted{color:#8390a1;font-size:13px;line-height:1.55}
 .ab2-shell .ab2-kicker{color:#ffcc00;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;margin:0 0 7px}
 .ab2-shell .ab2-badge{border:1px solid #38434d;color:#aab6c5;background:#10161b;border-radius:6px;padding:6px 9px;font-size:12px;white-space:nowrap}
 .ab2-shell .ab2-empty{padding:15px 0 5px;border-top:1px solid #252d36;margin-top:16px}
 .ab2-shell .ab2-state{font-weight:700;color:#c8d2dd;margin:0 0 5px}
 .ab2-shell .ab2-panel{padding:14px 0;margin-top:12px;border-top:1px solid #252d36;background:transparent}
 .ab2-shell .ab2-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
 .ab2-shell code{font-family:'Google Sans Code',ui-monospace,monospace;color:#ffcc00;font-size:14px;letter-spacing:.05em;user-select:text;overflow-wrap:anywhere}
 .ab2-shell input{width:100%;min-width:0;font-size:13px;letter-spacing:normal;text-transform:none;padding:9px 11px}
 .ab2-shell input[aria-label="B code from requesting Agent"]{letter-spacing:.1em;text-transform:uppercase}
 .ab2-shell .ab2-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
 .ab2-shell .ab2-actions .btn{font-size:13px;padding:9px 12px}
 .ab2-shell .ab2-timer{color:#aab6c5;font-variant-numeric:tabular-nums;font-size:13px;margin:5px 0 0}
 .ab2-shell .ab2-footnote{border-top:1px solid #252d36;margin:15px 0 0;padding-top:12px}
 @media(max-width:540px){.ab2-shell .ab2-grid{grid-template-columns:1fr}.ab2-shell .ab2-badge{font-size:12px}}
 </style>
 <div class="ab2-head">
  <div><div class="ab2-kicker">A/B V2 · Device authorization</div>
   <h2>Agent access requests</h2>
   <div class="ab2-muted">Review requests for this device before granting access.</div></div>
  <span class="ab2-badge">Up to 24 hours</span>
 </div>
 <div class="ab2-empty">
  <div id="abV2PreviewState" class="ab2-state">Checking requests…</div>
  <p class="ab2-muted" id="abV2PreviewStatus" role="status" aria-live="polite">Checking the signed request list.</p>
  <div class="ab2-actions"><button type="button" id="abV2PreviewRefresh" class="btn">Refresh</button>
  <a class="btn" href="https://light-remote.thaiduy.digital/account" target="_blank" rel="noopener noreferrer">Open Account</a>
  <a class="btn" href="/">Back to Wall</a></div>
 </div>
 <div id="abV2PreviewItems"></div>
 <p class="ab2-muted ab2-footnote">A/B V2 requests expire after 5 minutes. Each approval applies only to the requesting Agent.
  Approve by entering the Agent B code on this authenticated Local Wall or in Account. Each grant is scoped to the requesting Agent.</p>
</section>
<script>
(()=>{
 const host=document.getElementById('abV2OwnerPreview');
 const refresh=document.getElementById('abV2PreviewRefresh');
 const state=document.getElementById('abV2PreviewState');
 const status=document.getElementById('abV2PreviewStatus');
 const items=document.getElementById('abV2PreviewItems');
 if(!host||!refresh||!state||!status||!items)return;
 let pending=[],refreshInFlight=false;
 const fmtRemaining=(ms)=>{
  const sec=Math.max(0,Math.ceil(ms/1000));
  return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
 };
 function tick(){
  for(const row of pending){
   if(row.expiresNode){
    const left=Number(row.expiresAt)-Date.now();
    row.expiresNode.textContent=left>0?'Expires in '+fmtRemaining(left):'Request expired';
     row.expiresNode.dataset.phase=left<=60000?'danger':left<=90000?'warn':'ok';
    if(left<=0)row.expiresNode.className='ab2-muted';
   }
  }
 }
 async function load(){
  if(refreshInFlight)return;
  refreshInFlight=true;refresh.disabled=true;
  try{
   const resp=await fetch('/api/abv2/pending',{credentials:'same-origin',cache:'no-store'});
   if(resp.status===404){host.hidden=true;return;}
   if(!resp.ok){host.hidden=true;return;}
   const data=await resp.json();
   if(data?.ok!==true||!Array.isArray(data.pending))throw Error('Invalid signed request feed');
   host.hidden=false;
   // Swap the legacy card only if a working V2 backend is actually present.
   // In V1 production, failed/disabled V2 leaves the original Wall approval.
   const legacy=document.querySelector('.wrap>.card:not(#abV2OwnerPreview)');
   if(legacy)legacy.hidden=true;
   items.replaceChildren();pending=[];
   const approvalEnabled=data.ownerApproveEnabled===true;
   const consentRequired=data.ownerConsentRequired!==false;
   state.textContent=data.pending.length?'Requests awaiting approval':'No pending requests';
   status.textContent=data.pending.length
      ?data.pending.length+' signed request(s) awaiting owner verification'
      :'When an Agent requests access, it will appear here.';
   for(const row of data.pending.slice(0,5)){
    const card=document.createElement('div');card.className='ab2-panel';
    const name=document.createElement('h3');
    name.textContent='Agent requests access to this device';
    const expire=document.createElement('p');expire.className='ab2-timer';
    const codes=document.createElement('div');codes.className='ab2-grid';
    const a=document.createElement('div');a.className='ab2-muted';
    const code=document.createElement('code');
    code.textContent=String(row.aCode||'');
    a.append('A code · one-time',document.createElement('br'),code);
    const b=document.createElement('div');b.className='ab2-muted';
    const input=document.createElement('input');input.type='text';input.maxLength=9;
    input.autocomplete='one-time-code';input.placeholder='B: ____-____';
    input.setAttribute('aria-label','B code from requesting Agent');
    b.append('B code · ••••-••••',document.createElement('br'),input);
    codes.append(a,b);card.append(name,expire,codes);
    const consent=document.createElement('input');consent.type='password';
    consent.maxLength=32;consent.autocomplete='off';
    consent.placeholder='Account-verified one-time Owner consent';
    consent.setAttribute('aria-label','Owner account-verified one-time consent');
    consent.style.marginTop='12px';
    const actions=document.createElement('div');actions.className='ab2-actions';
    const approve=document.createElement('button');
    approve.className='btn primary';approve.type='button';
    approve.textContent='Approve Agent · 24h';approve.disabled=!approvalEnabled;
    approve.onclick=async()=>{
     const bCode=String(input.value||'').trim().toUpperCase();
     const consentCode=String(consent.value||'').trim();
     if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(bCode)){
      status.textContent='Enter the B code provided by the requesting Agent.';return;
     }
     if(consentRequired&&!/^[A-Za-z0-9_-]{32}$/.test(consentCode)){
      status.textContent='Generate the one-time Owner consent at /account.';return;
     }
     if(!await window.lrWebConfirm?.('Grant this Agent access to this device for up to 24 hours?'))return;
     approve.disabled=true;
     try{
      const result=await fetch('/api/abv2/approve',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'content-type':'application/json','x-light-remote-csrf':
        typeof wallCsrf==='string'?wallCsrf:''},
       body:JSON.stringify({requestId:row.requestId,expectedAttempt:row.attempt,bCode,
        ...(consentRequired?{consentCode}:{})})
      });
      const outcome=await result.json().catch(()=>({}));
      input.value='';consent.value='';
      if(!result.ok||outcome.state!=='granted')throw Error('Grant not committed by Operator');
      status.textContent='Owner approval committed. Agent lease granted.';
      await load();
     }catch(error){input.value='';consent.value='';status.textContent=String(error.message||'Approval unavailable');}
     finally{approve.disabled=!approvalEnabled;}
    };
    actions.append(approve);
    if(consentRequired)card.append(consent);
    card.append(actions);
    if(!approvalEnabled){
      const notice=document.createElement('p');notice.className='ab2-muted';
      notice.textContent='Direct approval is unavailable. Open Account to check the Owner approval settings.';
      card.append(notice);
    }
    items.append(card);pending.push({expiresAt:row.expiresAt,expiresNode:expire});
   }
   tick();
  }catch(error){status.textContent='Signed A/B V2 request feed unavailable';}
  finally{refreshInFlight=false;refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 setInterval(()=>{if(!document.hidden){tick();void load();}},12000);
 void load();
})();
</script>`;