const $=id=>document.getElementById(id);let csrf='',current=null,canSend=false,drafts=[];
function feedback(text){$('feedback').textContent=text}
async function api(path,method='GET',payload){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'content-type':'application/json','x-csrf':csrf},body:payload===undefined?undefined:JSON.stringify(payload)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'HTTP '+response.status);return result;
}
function draftForm(){
 return {brand:$('brand').value,conversation_uuid:$('conversation').value.trim(),recipient:$('recipient').value.trim(),
 subject:$('subject').value.trim(),message:$('message').value.trim(),based_on_message_uuid:$('latest').value.trim()};
}
function fill(item){
 current=item||null;
 $('editorTitle').textContent=item?'Draft '+item.status:'New support draft';
 $('brand').value=item?.brand||'light-remote';
 $('conversation').value=item?.conversation_uuid||'';
 $('recipient').value=item?.recipient||'';
 $('subject').value=item?.subject||'';
 $('message').value=item?.message||'';
 $('latest').value=item?.based_on_message_uuid||'';
 $('approve').disabled=!item||item.status!=='draft';
 $('send').disabled=!item||item.status!=='approved'||!canSend;
 $('hint').textContent=item?.status==='sent'?'This response has been sent.':
  !canSend?'Outbound disabled until agent API credentials are verified.':
  item?.status==='approved'?'Ready for owner-authorized send after checking conversation freshness.':
  'Review and approve a draft before sending.';
}
function render(){
 const target=$('drafts');target.replaceChildren();
 for(const d of drafts){
  const b=document.createElement('button');b.type='button';b.className='draft'+(current?.id===d.id?' active':'');
  const title=document.createElement('strong');title.textContent=d.subject;
  const sub=document.createElement('small');sub.textContent=d.brand+' · '+d.status+' · v'+d.version;
  b.append(title,sub);b.addEventListener('click',()=>{fill(d);render()});target.append(b);
 }
}
async function refresh(){
 const data=await api('/api/drafts');drafts=data.drafts;
 if(current)current=drafts.find(d=>d.id===current.id)||null;
 render();fill(current);
}
async function init(){
 try{
  const session=await api('/api/session');csrf=session.csrf;canSend=session.outbound_ready;
  $('login').hidden=true;$('workspace').hidden=false;
  $('email').value=session.email;
  $('outbound').textContent=canSend?'Outbound API configured: owner approval is mandatory.':
   'UAT safe mode: Libredesk API send credentials not yet connected. Drafts and approvals are available.';
  await refresh();
 }catch{$('login').hidden=false;$('workspace').hidden=true}
}
$('loginForm').addEventListener('submit',async ev=>{
 ev.preventDefault();try{
 const r=await api('/api/login','POST',{email:$('email').value,password:$('password').value});csrf=r.csrf;$('password').value='';
 feedback('Signed in');await init();
 }catch(e){feedback(e.message)}
});
$('changePasswordForm').addEventListener('submit',async ev=>{
 ev.preventDefault();
 try{
  await api('/api/account/password','POST',
   {current_password:$('currentPassword').value,new_password:$('newPassword').value});
  $('currentPassword').value='';$('newPassword').value='';csrf='';
  $('login').hidden=false;$('workspace').hidden=true;
  feedback('Password changed. Please sign in again.');
 }catch(e){feedback('Password change: '+e.message)}
});
$('refresh').addEventListener('click',()=>refresh().catch(e=>feedback(e.message)));
$('newDraft').addEventListener('click',()=>{fill(null);render()});
$('save').addEventListener('click',async()=>{
 try{const d=draftForm();const result=current?
 await api('/api/drafts/'+current.id,'PATCH',d):await api('/api/drafts','POST',d);
 feedback('Draft saved');current={id:result.id||current.id};await refresh();
 }catch(e){feedback('Save: '+e.message)}
});
$('approve').addEventListener('click',async()=>{
 if(!current)return;try{await api('/api/drafts/'+current.id+'/approve','POST',{version:current.version});
 feedback('Owner approval recorded');await refresh();
 }catch(e){feedback('Approve: '+e.message)}
});
$('send').addEventListener('click',async()=>{
 if(!current||!canSend||current.status!=='approved')return;
 $('send').disabled=true;
 try{await api('/api/drafts/'+current.id+'/send','POST',{version:current.version});
 feedback('Response sent through Libredesk');await refresh();
 }catch(e){feedback('Send not completed: '+e.message);await refresh()}
});
void init();