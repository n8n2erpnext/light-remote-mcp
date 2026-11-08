document.addEventListener('DOMContentLoaded',()=>{
 const source=document.getElementById('access-code');
 if(!source||!source.form)return;
 const form=source.form;
 const wrap=document.createElement('div');
 wrap.className='code-slots';
 wrap.setAttribute('role','group');
 wrap.setAttribute('aria-label','Eight-character ticket access code');
 const cells=[];
 const accepted=/^[A-HJ-NP-Z2-9]$/;
 const clean=(value)=>String(value||'').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,'');
 const feedback=document.createElement('small');
 feedback.className='code-hint';
 feedback.setAttribute('role','status');
 feedback.textContent='Eight characters. A dash is displayed automatically; punctuation is ignored when pasted.';
 function sync(){
  source.value=cells.map(cell=>cell.value).join('');
  feedback.classList.remove('error');
 }
 function fill(text,start){
  const chars=clean(text);
  if(!chars.length)return;
  let at=start;
  for(const char of chars){if(at>=8)break;cells[at++].value=char;}
  sync();
  cells[Math.min(at,7)].focus();
 }
 for(let i=0;i<8;i++){
  if(i===4){
   const divider=document.createElement('span');
   divider.className='code-divider';
   divider.setAttribute('aria-hidden','true');
   divider.textContent='–';
   wrap.appendChild(divider);
  }
  const cell=document.createElement('input');
  cell.className='code-cell';
  cell.type='text';
  cell.inputMode='text';
  cell.maxLength=1;
  cell.autocapitalize='characters';
  cell.autocorrect='off';
  cell.spellcheck=false;
  cell.setAttribute('aria-label','Code character '+(i+1)+' of 8');
  if(i===0)cell.autocomplete='one-time-code';
  else cell.autocomplete='off';
  cell.addEventListener('input',()=>{
   const raw=cell.value;
   const filtered=clean(raw);
   if(filtered.length>1){fill(filtered,filtered.length===8?0:i);return;}
   cell.value=filtered.slice(0,1);
   sync();
   if(cell.value&&i<7)cells[i+1].focus();
  });
  cell.addEventListener('paste',event=>{
   event.preventDefault();
   const text=event.clipboardData?.getData('text')||'';
   const chars=clean(text);
   fill(chars,chars.length===8?0:i);
  });
  cell.addEventListener('keydown',event=>{
   if(event.key==='Backspace'){
    if(cell.value){cell.value='';sync();}
    else if(i>0){cells[i-1].value='';cells[i-1].focus();sync();}
    event.preventDefault();
   }else if(event.key==='ArrowLeft'&&i>0){cells[i-1].focus();event.preventDefault();}
   else if(event.key==='ArrowRight'&&i<7){cells[i+1].focus();event.preventDefault();}
   else if(event.key==='Home'){cells[0].focus();event.preventDefault();}
   else if(event.key==='End'){cells[7].focus();event.preventDefault();}
   else if(event.key.length===1&&!accepted.test(event.key.toUpperCase())&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    event.preventDefault();
   }
  });
  cells.push(cell);
  wrap.appendChild(cell);
 }
 source.type='hidden';
 source.value='';
 source.insertAdjacentElement('afterend',wrap);
 wrap.insertAdjacentElement('afterend',feedback);
 form.addEventListener('submit',event=>{
  sync();
  const firstEmpty=cells.findIndex(cell=>!cell.value);
  if(firstEmpty!==-1){
   event.preventDefault();
   feedback.textContent='Please enter all eight access-code characters.';
   feedback.classList.add('error');
   cells[firstEmpty].focus();
  }else source.value=cells.map(c=>c.value).join('');
 });
 cells[0].focus();
});
