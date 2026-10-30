// Gold P2-I2f: added only to Local Wall /approve. Hidden when flag OFF.
// READ-ONLY. User must have authenticated as the actual account email.
export const wallAbV2PreviewFragment=`
<section id="abV2OwnerPreview" hidden style="margin-top:18px;padding:15px;border:1px solid #34475a;border-radius:10px;background:#101923" aria-label="A/B V2 Agent requests">
 <h3 style="margin:0 0 8px">Pending Agent requests · A/B V2 preview</h3>
 <p class="muted">Read-only preview for this device. The Agent holds B. Approval will be available only after the grant bridge is complete. Manual V1 pairing above remains available.</p>
 <button type="button" id="abV2PreviewRefresh" class="btn">Refresh status</button>
 <p id="abV2PreviewStatus" class="muted" role="status"></p>
 <div id="abV2PreviewItems"></div>
</section>
<script>
(()=>{
 const host=document.getElementById('abV2OwnerPreview');
 const button=document.getElementById('abV2PreviewRefresh');
 const status=document.getElementById('abV2PreviewStatus');
 const items=document.getElementById('abV2PreviewItems');
 if(!host||!button||!status||!items)return;
 async function load(){
  button.disabled=true;
  try{
   const response=await fetch('/api/abv2/pending',{credentials:'same-origin',cache:'no-store'});
   if(response.status===404){host.hidden=true;return}
   if(!response.ok){host.hidden=true;return}
   const data=await response.json();
   if(data?.ok!==true||!Array.isArray(data.pending))return;
   host.hidden=false;items.replaceChildren();
   status.textContent=data.pending.length+' pending request(s) · signed device preview';
   for(const row of data.pending.slice(0,5)){
    const wrapper=document.createElement('div');
    wrapper.style.cssText='padding:10px;margin-top:9px;border:1px solid #2c3947;border-radius:8px';
    const line=document.createElement('div');
    const exp=Number(row.expiresAt);
    line.textContent='Agent: '+String(row.requester||'Authorized Agent')+' · expires '+
      (Number.isFinite(exp)?new Date(exp).toLocaleTimeString():'unknown');
    const code=document.createElement('code');
    code.textContent=String(row.aCode||'');
    wrapper.append(line,code);items.append(wrapper);
   }
  }catch{host.hidden=true}
  finally{button.disabled=false}
 }
 button.addEventListener('click',load);
 void load();
})();
</script>`;
