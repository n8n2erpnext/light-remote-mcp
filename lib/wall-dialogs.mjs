/**
 * App-owned confirmation dialogs on supporting Gold Wall pages.
 * The main Local Wall uses its original modal container for identical UX.
 */
export const WALL_DIALOG_EMBED = `<style>
#wallDialogBackdrop[hidden],#wallDialogField[hidden]{display:none!important}
#wallDialogBackdrop{position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000b}
#wallDialogCard{background:#10171e;color:#e4edf5;border:1px solid #3b5267;border-radius:12px;width:min(510px,100%);padding:18px;box-shadow:0 20px 75px #000b}
#wallDialogText{white-space:pre-wrap;line-height:1.5;margin:0 0 12px;overflow-wrap:anywhere}
#wallDialogField{box-sizing:border-box;width:100%;padding:9px;background:#090f15;color:#e4edf5;border:1px solid #61758a;border-radius:7px;margin-bottom:12px;font:inherit}
#wallDialogActions{display:flex;justify-content:flex-end;gap:8px}
#wallDialogActions button{border:1px solid #516276;border-radius:7px;background:#182430;color:#e4edf5;padding:8px 14px;cursor:pointer;font:inherit}
#wallDialogAccept[data-danger="true"]{border-color:#873d49;color:#ffbbc3}
#wallDialogActions button:focus-visible,#wallDialogField:focus-visible{outline:2px solid #6caaff;outline-offset:2px}
</style><div id="wallDialogBackdrop" role="dialog" aria-modal="true" aria-labelledby="wallDialogText" aria-hidden="true" hidden><div id="wallDialogCard"><div id="wallDialogText"></div><input id="wallDialogField" type="text" autocomplete="off" aria-label="Confirmation text" maxlength="2000" hidden><div id="wallDialogActions"><button id="wallDialogCancel" type="button">Cancel</button><button id="wallDialogAccept" type="button">Confirm</button></div></div></div><script>
(function(){
let active=false;
function show(message,{input=false,initial=''}={}){
 return new Promise(resolve=>{
  const root=document.getElementById('wallDialogBackdrop'),label=document.getElementById('wallDialogText'),field=document.getElementById('wallDialogField'),
    ok=document.getElementById('wallDialogAccept'),cancel=document.getElementById('wallDialogCancel');
  if(active||!root){resolve(input?null:false);return;}
  active=true;
  const previous=document.activeElement;
  label.textContent=String(message||'Confirm action?');
  field.hidden=!input;field.value=input?String(initial??'').slice(0,2000):'';
  ok.textContent=input?'Continue':'Confirm';
  ok.dataset.danger=String(!input&&/delete|remove|revoke|stop|force|cancel/i.test(String(message)));
  root.hidden=false;root.setAttribute('aria-hidden','false');
  function finish(confirmed){
    root.hidden=true;root.setAttribute('aria-hidden','true');
    root.removeEventListener('keydown',onKeys);root.onclick=null;cancel.onclick=null;ok.onclick=null;field.hidden=true;active=false;
    resolve(confirmed?(input?field.value:true):(input?null:false));
    if(previous?.focus)previous.focus();
  }
  function onKeys(e){
   if(e.key==='Escape'){e.preventDefault();finish(false);}
   if(e.key==='Enter'&&e.target===field){e.preventDefault();finish(true);}
   if(e.key==='Tab'){
    const nodes=input?[field,cancel,ok]:[cancel,ok],first=nodes[0],last=nodes[nodes.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  }
  root.addEventListener('keydown',onKeys);
  root.onclick=e=>{if(e.target===root)finish(false)};
  cancel.onclick=()=>finish(false);ok.onclick=()=>finish(true);
  (input?field:cancel).focus();
 });
}
window.wallConfirm=message=>show(message);
window.wallPrompt=(message,initial='')=>show(message,{input:true,initial});
})();
</script>`;
