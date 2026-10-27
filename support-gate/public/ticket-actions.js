document.addEventListener('DOMContentLoaded',()=>{
 const button=document.getElementById('printReady');
 if(button){
  const status=document.createElement('span');
  status.id='print-status';
  status.className='print-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  button.insertAdjacentElement('afterend',status);
  button.addEventListener('click',async()=>{
   if(button.disabled)return;
   const url=button.dataset.printUrl;
   if(!url||!url.startsWith('https://support.thaiduy.digital/ai-support/t/'))return;
   button.disabled=true;
   const original=button.innerHTML;
   button.innerHTML='<span class="material-icon" aria-hidden="true">hourglass_top</span> Preparing…';
   status.textContent='';
   let frame;
   const reset=()=>{
    button.disabled=false;
    button.innerHTML=original;
    if(frame){frame.remove();frame=null;}
   };
   try{
    // Retrieve all ticket messages once, keeping the customer on the same page.
    // An about:srcdoc frame has no secret ticket URL in the browser print header.
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Unable to load the full conversation. Check your ticket access.');
    const html=await response.text();
    if(!html.includes('class="print-view"')||!html.includes('class="timeline"'))
     throw new Error('Unable to verify the printable ticket.');
    frame=document.createElement('iframe');
    frame.className='ticket-print-frame';
    frame.title='Complete support conversation for printing';
    frame.setAttribute('aria-hidden','true');
    frame.setAttribute('tabindex','-1');
    frame.loading='eager';
    const loaded=new Promise((resolve,reject)=>{
     frame.addEventListener('load',resolve,{once:true});
     frame.addEventListener('error',()=>reject(new Error('Print document could not load.')),{once:true});
    });
    document.body.appendChild(frame);
    frame.srcdoc=html;
    await loaded;
    const doc=frame.contentDocument;
    if(!doc||!doc.querySelector('.print-view .timeline'))
     throw new Error('Printable content did not render.');
    if(doc.fonts&&doc.fonts.ready)await doc.fonts.ready;
    await Promise.all([...doc.images].map(img=>typeof img.decode==='function'?img.decode().catch(()=>{}):Promise.resolve()));
    // Calling print() on the prepared iframe uses Chrome's normal system print
    // dialog and does not open a new tab or change window.location.
    frame.contentWindow.addEventListener('afterprint',()=>{status.textContent='';reset();},{once:true});
    frame.contentWindow.focus();
    frame.contentWindow.print();
    button.disabled=false;
    button.innerHTML=original;
   }catch(error){
    reset();
    status.textContent=(error&&error.message)||'Printing is temporarily unavailable. Please try again.';
   }
  });
 }
 document.querySelectorAll('.status-tag').forEach(tag=>tag.addEventListener('click',()=>{
  const details=document.getElementById('status-info');
  if(details)details.open=true;
 }));
});
