// Native Local Wall A/B V2 approval UI, shared by Windows/macOS/Linux.
 // Only rendered after authenticated local Owner; never generates A/B.
// Signed Operator preview; human B + authenticated Owner mandatory. Outside the isolated Lab, an independent Owner consent is additionally required.
export const wallAbV2PreviewFragment = `
<section id="abV2OwnerPreview" class="card ab2-shell" aria-label="A/B V2 Agent approval">
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
 .ab2-shell .ab2-grid{display:grid;grid-template-columns:minmax(240px,1fr) 64px minmax(340px,1.15fr);gap:14px;align-items:stretch;margin-top:14px}
 .ab2-shell .ab2-code-card{border:1px solid #2b3742;background:#10171e;border-radius:12px;padding:19px;min-width:0}
 .ab2-shell .ab2-card-title{font-size:15px;font-weight:750;color:#e4edf4;margin:0 0 10px}
 .ab2-shell .ab2-card-help{color:#96a6b8;font-size:12px;line-height:1.5;margin:14px 0 0;max-width:42ch}
 .ab2-shell code{display:block;font-family:'Google Sans Code',ui-monospace,monospace;color:#ffcc00;font-size:26px;font-weight:800;line-height:1.4;letter-spacing:.04em;user-select:text;overflow-wrap:anywhere}
 .ab2-shell .ab2-flow{display:flex;align-items:center;justify-content:center;color:#ffcc00;min-width:0}
 .ab2-shell .ab2-flow svg{width:38px;height:38px;filter:drop-shadow(0 0 5px #ffd42a30);animation:ab2-arrow-slide 2.4s ease-in-out infinite}
 @keyframes ab2-arrow-slide{0%,100%{transform:translateX(-3px);opacity:.7}50%{transform:translateX(4px);opacity:1}}
 .ab2-shell .ab2-digits{display:flex;align-items:center;justify-content:flex-start;gap:clamp(3px,.45vw,9px);margin-top:12px;max-width:100%}
 .ab2-shell .ab2-digit{width:clamp(25px,3.2vw,48px);min-width:0;max-width:48px;height:54px;text-align:center;flex:0 1 48px;border:1px solid #41566b;border-radius:8px;background:#09121a;color:#f4f7fc;padding:0;font:800 24px/1 'Google Sans Code',ui-monospace,monospace;text-transform:uppercase}
 .ab2-shell .ab2-digit:focus-visible{outline:2px solid #e6bd32;outline-offset:2px;border-color:#e6bd32}
 .ab2-shell .ab2-digit-separator{color:#92a4b8;font:800 24px 'Google Sans Code',monospace;flex:none}
 .ab2-shell .ab2-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px}
 .ab2-shell .ab2-actions .btn{font-size:13px;padding:9px 12px}
 .ab2-shell input:not(.ab2-digit){width:100%;min-width:0;font-size:13px;letter-spacing:normal;text-transform:none;padding:9px 11px}
 @media(prefers-reduced-motion:reduce){.ab2-shell .ab2-flow svg{animation:none}}
 @media(max-width:920px){.ab2-shell .ab2-grid{grid-template-columns:minmax(0,1fr)}.ab2-shell .ab2-flow svg{transform:rotate(90deg);animation:none}.ab2-shell .ab2-flow{min-height:28px}}
 @media(max-width:540px){.ab2-shell .ab2-code-card{padding:13px}.ab2-shell .ab2-digit{height:46px;font-size:20px}.ab2-shell code{font-size:22px}}
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
</div>
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
 let pending=[],refreshInFlight=false,approvalInFlight=false,activeApproval=null,renderedKeys='';
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
   if(!resp.ok){
     if(activeApproval)activeApproval.invalidated=true;
     if(approvalInFlight){
      status.textContent='Signed request verification unavailable during approval. The current attempt cannot be submitted.';
      return;
     }
     // Never fall back to an unsigned or legacy V1 approval page.
     host.hidden=false;items.replaceChildren();pending=[];renderedKeys='';
     state.textContent='Signed A/B V2 requests unavailable';
     status.textContent=resp.status===401||resp.status===403
      ?'Owner sign-in or permission was rejected. Sign in and Refresh.'
      :'Cannot verify signed requests. Check connection and Refresh.';
     return;
   }
   const data=await resp.json();
   if(data?.ok!==true||!Array.isArray(data.pending))throw Error('Invalid signed request feed');
   const newKeys=data.pending.slice(0,5).map(row=>
    String(row.requestId)+':'+String(row.attempt)).join('|');
   if(activeApproval){
    const same=data.pending.some(row=>
     activeApproval.key===String(row.requestId)+':'+String(row.attempt)&&
     Number(row.expiresAt)>Date.now());
    if(!same||data.ownerApproveEnabled!==true||
       (data.ownerConsentRequired!==false)!==activeApproval.consentRequired)
      activeApproval.invalidated=true;
   }
   // Keep the form (and closure) stable across focus->confirm->POST, but still
   // evaluate each signed refresh for revocation and attempt rotation.
   if(approvalInFlight){
    if(activeApproval?.invalidated)status.textContent=
     'The signed request changed or expired. Approval is blocked; refresh before trying again.';
    tick();return;
   }
   const focused=document.activeElement;
   const editing=focused&&items.contains(focused)&&
    (focused.classList?.contains('ab2-digit')||
     focused.getAttribute('aria-label')==='Owner account-verified one-time consent');
   if(editing&&newKeys===renderedKeys){tick();return;}
   const changedWhileEditing=Boolean(editing&&newKeys!==renderedKeys);
   host.hidden=false;
   // Swap the legacy card only if a working V2 backend is actually present.
   // In V1 production, failed/disabled V2 leaves the original Wall approval.
   const legacy=document.querySelector('.wrap>.card:not(#abV2OwnerPreview)');
   if(legacy)legacy.hidden=true;
   items.replaceChildren();pending=[];renderedKeys=newKeys;
   const approvalEnabled=data.ownerApproveEnabled===true;
   const consentRequired=data.ownerConsentRequired!==false;
   state.textContent=data.pending.length?'Requests awaiting approval':'No pending requests';
   status.textContent=changedWhileEditing
      ?'Signed request attempt changed. Previous B/consent inputs were cleared; review the new attempt.'
      :data.pending.length
       ?data.pending.length+' signed request(s) awaiting owner verification'
       :'When an Agent requests access, it will appear here.';
   for(const row of data.pending.slice(0,5)){
    const card=document.createElement('div');card.className='ab2-panel';
    const name=document.createElement('h3');
    name.textContent='Agent requests access to this device';
    const expire=document.createElement('p');expire.className='ab2-timer';
    const codes=document.createElement('div');codes.className='ab2-grid';
    const a=document.createElement('section');a.className='ab2-code-card';
    a.setAttribute('aria-label','Block A - one-time A code');
    const aTitle=document.createElement('h4');aTitle.className='ab2-card-title';aTitle.textContent='A code · one-time';
    const code=document.createElement('code');code.textContent=String(row.aCode||'');
    const guide=document.createElement('p');guide.className='ab2-card-help';
    guide.textContent='Get the B code from the AI chat, then enter it in Block B.';
    a.append(aTitle,code,guide);
    const flow=document.createElement('div');flow.className='ab2-flow';
    flow.setAttribute('role','img');flow.setAttribute('aria-label','From A code to B code');
    flow.innerHTML='<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M7 24h31m-12-12 12 12-12 12" stroke="currentColor" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    const b=document.createElement('section');b.className='ab2-code-card';
    b.setAttribute('aria-label','Block B - B code input');
    const bTitle=document.createElement('h4');bTitle.className='ab2-card-title';bTitle.textContent='B code';
    const bHelp=document.createElement('p');bHelp.className='ab2-muted';
    bHelp.textContent='Enter or paste the 8-character B code provided by the AI Agent.';
    const digits=document.createElement('div');digits.className='ab2-digits';
    digits.setAttribute('role','group');digits.setAttribute('aria-label','B code from requesting Agent');
    const cells=Array.from({length:8},(_,i)=>{
      const cell=document.createElement('input');cell.type='text';cell.maxLength=1;
      cell.className='ab2-digit';cell.inputMode='text';cell.autocomplete='off';
      cell.autocapitalize='characters';cell.spellcheck=false;
      cell.setAttribute('aria-label','B code character '+String(i+1)+' of 8');
      if(i===4){const dash=document.createElement('span');dash.className='ab2-digit-separator';dash.setAttribute('aria-hidden','true');dash.textContent='–';digits.append(dash);}
      digits.append(cell);return cell;
    });
    const normalizeBText=text=>{
      const raw=String(text||'').trim().toUpperCase().replace(/^B\\s*(?:CODE)?\\s*[:=]\\s*/i,'');
      const matched=raw.match(/(?:^|[^A-HJ-NP-Z2-9])([A-HJ-NP-Z2-9]{4})[\\s\\-]+([A-HJ-NP-Z2-9]{4})(?=$|[^A-HJ-NP-Z2-9])/);
      return matched?(matched[1]+matched[2]):raw.replace(/[^A-HJ-NP-Z2-9]/g,'');
    };
    const clearB=()=>{cells.forEach(cell=>{cell.value='';});};
    const readB=()=>{
      const value=cells.map(cell=>cell.value.toUpperCase()).join('');
      return /^[A-HJ-NP-Z2-9]{8}$/.test(value)?value.slice(0,4)+'-'+value.slice(4):'';
    };
    const fillB=(text,at)=>{
      const value=normalizeBText(text);
      if(!value){status.textContent='Use the eight characters shown in the AI chat.';return;}
      const start=value.length>=8?0:at;
      if(start===0)clearB();
      for(let j=0;j<value.length&&start+j<8;j++)cells[start+j].value=value[j];
      const next=cells.findIndex((cell,i)=>i>=start&&!cell.value);
      cells[next>=0?next:7].focus();
    };
    cells.forEach((cell,i)=>{
      cell.addEventListener('paste',event=>{event.preventDefault();fillB(event.clipboardData?.getData('text')||'',i);});
      cell.addEventListener('input',()=>{
        const value=normalizeBText(cell.value);
        if(value.length>1){fillB(value,i);return;}
        cell.value=value;
        if(value&&i<7)cells[i+1].focus();
      });
      cell.addEventListener('keydown',event=>{
        if(event.key==='Backspace'&&!cell.value&&i>0){event.preventDefault();cells[i-1].value='';cells[i-1].focus();}
        if(event.key==='ArrowLeft'&&i>0){event.preventDefault();cells[i-1].focus();}
        if(event.key==='ArrowRight'&&i<7){event.preventDefault();cells[i+1].focus();}
      });
      cell.addEventListener('focus',()=>cell.select());
    });
    b.append(bTitle,bHelp,digits);
    codes.append(a,flow,b);card.append(name,expire,codes);
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
     if(approvalInFlight||!approvalEnabled)return;
     const bCode=readB();
     const consentCode=String(consent.value||'').trim();
     if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(bCode)){
      status.textContent='Enter the B code provided by the requesting Agent.';return;
     }
     if(consentRequired&&!/^[A-Za-z0-9_-]{32}$/.test(consentCode)){
      status.textContent='Generate the one-time Owner consent at /account.';return;
     }
     const key=String(row.requestId)+':'+String(row.attempt);
     approvalInFlight=true;activeApproval={key,consentRequired,invalidated:false};
     approve.disabled=true;
     let granted=false;
     try{
      const confirmed=await window.lrWebConfirm?.('Grant this Agent access to this device for up to 24 hours?');
      if(!confirmed)return;
      if(activeApproval.invalidated||Number(row.expiresAt)<=Date.now())
       throw Error('Signed request changed or expired. Refresh and review the current request.');
      const result=await fetch('/api/abv2/approve',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'content-type':'application/json','x-light-remote-csrf':
        typeof wallCsrf==='string'?wallCsrf:''},
       body:JSON.stringify({requestId:row.requestId,expectedAttempt:row.attempt,bCode,
        ...(consentRequired?{consentCode}:{})})
      });
      const outcome=await result.json().catch(()=>({}));
      if(!result.ok){
       const error=String(outcome.error||'');
       if(result.status===409)
        throw Error('Signed B attempt changed or grant conflict. Refresh before any new approval.');
       if(result.status===401||result.status===403)
        throw Error('Owner login, CSRF, consent or device permission denied. Reauthenticate and Refresh.');
       if(result.status===400)
        throw Error('Invalid B code or Owner consent. Review the current request.');
       throw Error('Operator approval result unavailable. Outcome unknown; Refresh and verify before retrying.');
      }
      if(outcome.state!=='granted')
       throw Error('Durable Agent grant not confirmed. Outcome unknown; Refresh before retrying.');
      granted=true;status.textContent='Owner approval committed. Agent lease granted.';
     }catch(error){
      status.textContent=String(error.message||'Approval unavailable');
     }finally{
      clearB();consent.value='';
      activeApproval=null;approvalInFlight=false;
      approve.disabled=!approvalEnabled;
      if(granted)void load();
     }
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
  }catch(error){
    if(activeApproval)activeApproval.invalidated=true;
    status.textContent=approvalInFlight
     ?'Signed request feed failed during approval; outcome not submitted. Refresh before retrying.'
     :'Signed A/B V2 request feed unavailable';
  }finally{refreshInFlight=false;refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 setInterval(()=>{if(!document.hidden){tick();void load();}},12000);
 void load();
})();
</script>`;