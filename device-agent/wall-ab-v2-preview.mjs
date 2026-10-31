// Moryqa Windows A/B V2 owner-approval screen, rendered only after an
// authenticated local owner receives signed backend data. No fabricated A/B.
export const wallAbV2PreviewFragment = `
<section id="abV2OwnerPreview" hidden class="ab2-shell" aria-label="A/B V2 Owner authorization">
 <style>
 .ab2-shell{max-width:640px;margin:18px auto;padding:24px;border:1px solid #364d65;border-radius:15px;background:#111b27;color:#e7eef7}
 .ab2-shell h2{font-size:22px;line-height:1.3;margin:0 0 5px;color:#f1f6fc}
 .ab2-shell .ab2-muted{color:#a1b1c3;font-size:13px;line-height:1.55}
 .ab2-shell .ab2-head{display:flex;justify-content:space-between;gap:14px;align-items:center}
 .ab2-shell .ab2-badge{border:1px solid #4770ac;color:#b9d2ff;background:#1c2a42;border-radius:20px;padding:7px 13px;font-size:12px;white-space:nowrap}
 .ab2-shell .ab2-panel{background:#172435;border:1px solid #354761;border-radius:12px;padding:16px;margin-top:14px}
 .ab2-shell .ab2-panel h3{font-size:16px;color:#d7e8ff;margin:0 0 7px}
 .ab2-shell .ab2-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 .ab2-shell code{color:#ffe28d;font-size:16px;letter-spacing:.045em;user-select:text;overflow-wrap:anywhere}
 .ab2-shell input{width:100%;box-sizing:border-box;padding:11px 12px;background:#0b1520;color:#fff;border-radius:9px;border:1px solid #50657b;letter-spacing:.04em}
 .ab2-shell .ab2-btn{padding:10px 16px;border:1px solid #526b86;border-radius:9px;background:#1c3049;color:#e9f2ff;cursor:pointer;font:inherit}
 .ab2-shell .ab2-btn.primary{background:#205dc5;color:#fff;border-color:#205dc5}
 .ab2-shell .ab2-btn:disabled{opacity:.55;cursor:not-allowed}
 .ab2-shell .ab2-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:15px;align-items:center}
 .ab2-shell .ab2-timer{color:#87b4ff;font-variant-numeric:tabular-nums;font-weight:600}
 .ab2-shell .ab2-state{color:#78d7a2}
 @media(max-width:620px){.ab2-shell{padding:13px}.ab2-shell .ab2-grid{grid-template-columns:1fr}}
 </style>
 <div class="ab2-head">
  <div><h2>AI access · A/B V2</h2><div class="ab2-muted">Owner authorization · this Windows device</div></div>
  <span class="ab2-badge">24-hour Agent grant</span>
 </div>
 <div class="ab2-panel">
  <h3 id="abV2PreviewState" class="ab2-state">Ready for AI requests</h3>
  <p class="ab2-muted" id="abV2PreviewStatus" role="status" aria-live="polite">Checking signed Agent requests…</p>
  <div class="ab2-actions"><button type="button" id="abV2PreviewRefresh" class="ab2-btn">Refresh requests</button>
  <a class="ab2-btn" href="https://light-remote.thaiduy.digital/account" target="_blank" rel="noopener">Owner account</a></div>
 </div>
 <div id="abV2PreviewItems"></div>
 <p class="ab2-muted">A code: fixed 6-character device ID + rotating 5-character request code.
 B code: 4+4 from the Agent. Request expires after 5 minutes. No request code is generated while idle.
 Owner consent must be minted from your signed-in account. Grants apply to this Agent only.</p>
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
   const legacyCard=document.querySelector('.wrap .card');
   if(legacyCard)legacyCard.hidden=true;
   items.replaceChildren();pending=[];
   const approvalEnabled=data.ownerApproveEnabled===true;
   state.textContent=data.pending.length?'Agent requests pending':'Ready for AI requests';
   status.textContent=data.pending.length
      ?data.pending.length+' signed request(s) awaiting owner verification'
      :'Standby · No pending Agent request. No temporary A code while idle.';
   for(const row of data.pending.slice(0,5)){
    const card=document.createElement('div');card.className='ab2-panel';
    const name=document.createElement('h3');
    name.textContent=String(row.requester||'Authorized Agent')+' requests access';
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
    b.append('B code · 4+4',document.createElement('br'),input);
    codes.append(a,b);card.append(name,expire,codes);
    const consent=document.createElement('input');consent.type='password';
    consent.maxLength=32;consent.autocomplete='off';
    consent.placeholder='Account-verified one-time Owner consent';
    consent.setAttribute('aria-label','Owner account-verified one-time consent');
    consent.style.marginTop='12px';
    const actions=document.createElement('div');actions.className='ab2-actions';
    const approve=document.createElement('button');
    approve.className='ab2-btn primary';approve.type='button';
    approve.textContent='Approve Agent · 24h';approve.disabled=!approvalEnabled;
    approve.onclick=async()=>{
     const bCode=String(input.value||'').trim().toUpperCase();
     const consentCode=String(consent.value||'').trim();
     if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(bCode)){
      status.textContent='Enter the B code provided by the requesting Agent.';return;
     }
     if(!/^[A-Za-z0-9_-]{32}$/.test(consentCode)){
      status.textContent='Generate the one-time Owner consent at /account.';return;
     }
     if(!window.confirm('Grant this Agent access to this device for up to 24 hours?'))return;
     approve.disabled=true;
     try{
      const result=await fetch('/api/abv2/approve',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'content-type':'application/json','x-light-remote-csrf':
        typeof wallCsrf==='string'?wallCsrf:''},
       body:JSON.stringify({requestId:row.requestId,expectedAttempt:row.attempt,bCode,consentCode})
      });
      const outcome=await result.json().catch(()=>({}));
      input.value='';consent.value='';
      if(!result.ok||outcome.state!=='granted')throw Error('Grant not committed by Operator');
      status.textContent='Owner approval committed. Agent lease granted.';
      await load();
     }catch(error){input.value='';consent.value='';status.textContent=String(error.message||'Approval unavailable');}
     finally{approve.disabled=!approvalEnabled;}
    };
    actions.append(approve);card.append(consent,actions);
    if(!approvalEnabled){
      const notice=document.createElement('p');notice.className='ab2-muted';
      notice.textContent='Owner approval is not yet enabled on this backend.';
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