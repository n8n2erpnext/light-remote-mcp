document.addEventListener('DOMContentLoaded',()=>{
 const button=document.getElementById('printReady');
 if(button){
  button.addEventListener('click',()=>{
   if(button.disabled)return;
   const url=button.getAttribute('data-print-url');
   if(!url||!url.startsWith('https://support.thaiduy.digital/ai-support/t/'))return;
   button.disabled=true;
   const label=button.textContent;
   button.textContent='Preparing full history…';
   const frame=document.createElement('iframe');
   frame.className='ticket-print-frame';
   frame.title='Printable complete ticket';
   frame.setAttribute('aria-hidden','true');
   frame.setAttribute('tabindex','-1');
   let finished=false;
   const finish=()=>{
    if(finished)return;
    finished=true;
    button.disabled=false;
    button.textContent=label;
    frame.remove();
   };
   const failure=()=>{
    finish();
    window.alert('Unable to prepare the full ticket for printing. Please retry.');
   };
   // Fetch the complete authenticated transcript, then print it in an about:blank
   // same-origin frame. This avoids exposing the private UUID in browser print headers.
   document.body.appendChild(frame);
   (async()=>{
    try{
     const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
     if(!response.ok)throw new Error('print_fetch_failed');
     const html=await response.text();
     const doc=frame.contentDocument;
     if(!doc)throw new Error('print_frame_missing');
     doc.open();doc.write(html);doc.close();
     if(!doc.querySelector('.print-view .timeline'))throw new Error('print_view_missing');
     const styles=[...doc.querySelectorAll('link[rel="stylesheet"]')];
     await Promise.all(styles.map(link=>link.sheet?Promise.resolve():new Promise((resolve,reject)=>{
      link.addEventListener('load',resolve,{once:true});
      link.addEventListener('error',reject,{once:true});
     })));
     if(doc.fonts&&doc.fonts.ready)await doc.fonts.ready;
     await Promise.all([...doc.images].map(img=>img.decode?img.decode().catch(()=>{}):Promise.resolve()));
     frame.contentWindow.addEventListener('afterprint',finish,{once:true});
     frame.contentWindow.focus();
     frame.contentWindow.print();
    }catch{failure()}
   })();
  });
 }
 document.querySelectorAll('.status-tag').forEach(tag=>tag.addEventListener('click',()=>{
  const details=document.getElementById('status-info');
  if(details)details.open=true;
 }));
});
