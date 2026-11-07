export const WALL_UI_REFINEMENT_CSS = `
:root{--wall-sidebar-width:214px}
body .wrap{margin-left:calc(var(--wall-sidebar-width) + 12px);margin-right:12px;max-width:calc(100% - var(--wall-sidebar-width) - 24px)}
.wall-sidebar{position:fixed;left:0;top:0;bottom:0;width:var(--wall-sidebar-width);z-index:120;background:#0b1016;border-right:1px solid #27313c;padding:12px 9px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;overflow-x:hidden;transition:width .2s ease}
.wall-sidebar .sidebar-toggle{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#131e28;border:1px solid #344557;color:#d1e1f0;border-radius:9px;cursor:pointer;white-space:nowrap;min-height:42px}
.wall-sidebar .sidebar-toggle .mi{flex:none;width:18px;height:18px}.wall-sidebar .nav-menu-glyph{font-size:20px;line-height:1;flex:none;width:18px;text-align:center}
.sidebar-items{display:flex;flex-direction:column;align-items:stretch;gap:5px;min-width:0}
.sidebar-items .btn{justify-content:flex-start;min-height:38px;padding:8px 11px;white-space:nowrap;text-align:left;gap:11px;width:100%;font-size:13px}
.sidebar-items .mi{flex:none;width:17px;height:17px}
.sidebar-items form{margin:0;width:100%}
.sidebar-items .module-nav-status{margin-left:auto}
.sidebar-items .pill{overflow-wrap:anywhere}
.wall-sidebar .nav-label{white-space:nowrap}
body.wall-sidebar-collapsed{--wall-sidebar-width:63px}
body.wall-sidebar-collapsed .wall-sidebar{padding-left:7px;padding-right:7px}
body.wall-sidebar-collapsed .sidebar-items .btn{justify-content:center;padding:8px}
body.wall-sidebar-collapsed .sidebar-items .btn span,body.wall-sidebar-collapsed .sidebar-toggle .nav-label{display:none}
body.wall-sidebar-collapsed .sidebar-toggle{justify-content:center;padding:9px}
body.wall-sidebar-collapsed .sidebar-items .pill,body.wall-sidebar-collapsed #enrollMsg{display:none!important}
.topright{flex:1;min-width:0;justify-content:flex-end;gap:9px}
.topright .wall-notification{margin-left:auto}
#conn{font-size:14px;font-weight:700;display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
#conn::before{content:'';width:8px;height:8px;border-radius:999px;background:#8b98a6;flex:none}
#conn.ok::before{background:#4cde91;animation:lr-live-ping 2s ease-out infinite}
#conn.running::before{background:#f1b761}
@keyframes lr-live-ping{0%{box-shadow:0 0 0 0 #42ce7866}65%{box-shadow:0 0 0 8px #42ce7800}100%{box-shadow:0 0 0 0 #42ce7800}}
@media(prefers-reduced-motion:reduce){#conn.ok::before{animation:none}.wall-sidebar{transition:none}}
.ab-v2-status{display:inline-flex;align-items:center;gap:5px;font-size:13px;white-space:normal;flex-wrap:wrap}
.ab-v2-status strong{font-family:'Google Sans Code',monospace;font-size:13px;color:#f3c94f;letter-spacing:.035em}
.ab-v2-status .ab-sep{color:#728092}
.ab-v2-status #abV2State{color:#94a0ad}
.ab-v2-status[data-phase="pending"] #abV2State,.ab-v2-status[data-phase="pending"] #abV2Timer{color:#6ee7a4}
.ab-v2-status[data-phase="yellow"] #abV2State,.ab-v2-status[data-phase="yellow"] #abV2Timer{color:#f5d76a}
.ab-v2-status[data-phase="orange"] #abV2State,.ab-v2-status[data-phase="orange"] #abV2Timer{color:#ffa85c}
.ab-v2-status[data-phase="red"] #abV2State,.ab-v2-status[data-phase="red"] #abV2Timer,.ab-v2-status[data-phase="expired"] #abV2State{color:#ff7979}
.ab-v2-status #abV2Timer{font:700 12px 'Google Sans Code',monospace;font-variant-numeric:tabular-nums}
.wall-brand-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px}
.wall-brand-status .ab-v2-status{max-width:min(100%,780px)}
.wall-brand-status #conn{padding:6px 10px}
.ab-v2-status #abV2AValue{color:#f0c94d;font:700 12px 'Google Sans Code',monospace;letter-spacing:.025em;user-select:text}
.ab-v2-status[data-phase="standby"] #abV2AValue{color:#93a0b1}
.wall-sidebar .sidebar-items>a[data-wall-current="true"]{background:#1c2834;border-color:#456277;color:#f1f6fc}
.wall-subpage .wrap{max-width:950px;margin:16px auto;padding:18px 22px;transform:translateX(calc(var(--wall-sidebar-width) / 2));}
.wall-subpage.wall-approve .wrap{max-width:680px}
.wall-subpage .wall-back,.wall-subpage #backToWall{display:none!important}
.wall-subpage .wall-sidebar .sidebar-items .btn{padding:8px 11px;font-size:13px;display:inline-flex;align-items:center}
.wall-subpage.wall-sidebar-collapsed .wall-sidebar .sidebar-items .btn{padding:8px}
.ab-grant-grid{display:grid;grid-template-columns:repeat(2,minmax(0,max-content));gap:7px 9px;align-items:start;margin-top:5px}
.ab-grant-grid .ab-grant-agent-row{display:inline-flex;min-width:0;width:max-content;max-width:100%;align-items:center;overflow-wrap:anywhere;font-size:12px;padding:5px 9px}
.ab-grant-grid .ab-grant-agent-row[data-phase="warn"]{border-color:#86651e;background:#241b0b;color:#ffd17b}
.ab-grant-grid .ab-grant-agent-row[data-phase="danger"]{border-color:#8a3540;background:#271014;color:#ff919e}
.ab-v2-status[data-phase="yellow"] #abV2State,.ab-v2-status[data-phase="yellow"] #abV2Timer{color:#f3ad59}
.ab-v2-status[data-phase="orange"] #abV2State,.ab-v2-status[data-phase="orange"] #abV2Timer{color:#f3ad59}
.ab-v2-status[data-phase="pending"] #abV2AValue{color:#6ee7a4}
.ab-v2-status[data-phase="orange"] #abV2AValue{color:#f3ad59}
.ab-v2-status[data-phase="red"] #abV2AValue{color:#ff7979}
.lr-time-warn{color:#ffba62}
.lr-time-danger{color:#ff838e}
.ab2-shell .ab2-timer[data-phase="warn"]{color:#ffba62}
.ab2-shell .ab2-timer[data-phase="danger"]{color:#ff838e}

.wall-native-dialog{border:1px solid #445261;border-radius:12px;background:#111920;color:#e1eaf2;max-width:min(440px,calc(100vw - 30px));width:100%;padding:18px 20px;box-shadow:0 20px 70px #000b;font-family:'Google Sans',sans-serif}
.wall-native-dialog::backdrop{background:#000b;backdrop-filter:blur(2px)}
.wall-native-dialog p{margin:0 0 18px;font-size:14px;line-height:1.55}
.wall-native-dialog .wall-dialog-actions{display:flex;justify-content:flex-end;gap:9px}
.wall-native-dialog button{background:#18232d;color:#dce5ed;border:1px solid #425262;border-radius:7px;padding:8px 15px;font:600 13px 'Google Sans',sans-serif;cursor:pointer}
.wall-native-dialog button[data-confirm]{background:#f1bf25;color:#0b0e11;border-color:#f1bf25}
#devicebox a:not(:hover){text-decoration:none}
#devicebox a:hover{text-decoration:none;color:#c2e8ff}
@media(max-width:1050px){.wall-subpage .wrap{margin-left:calc(var(--wall-sidebar-width) + 10px);margin-right:12px;max-width:calc(100% - var(--wall-sidebar-width) - 22px);transform:none}}
@media(max-width:640px){.ab-grant-grid{grid-template-columns:1fr}.ab-grant-grid .ab-grant-agent-row{width:auto}.wall-subpage .wrap{padding:12px}}

.ab-v2-status #abV2ApproveLink{border:1px solid #276442;border-radius:5px;color:#90f3b9;text-decoration:none;padding:2px 6px;font-size:12px}
.ab-v2-status [hidden]{display:none!important}
.term{font-family:'Google Sans Code',ui-monospace,monospace}
.term .head{font-size:12px;font-weight:650;padding:8px 10px}
.term #jobs{padding:5px}
.term .job{margin:5px 0}
.term .commandrow{grid-template-columns:max-content minmax(0,1fr) auto;grid-template-areas:"lead command actions";gap:8px;padding:8px;align-items:start;font-size:13.5px}.term .joblead{grid-area:lead;display:flex;align-items:center;white-space:nowrap;gap:12px}.term .cmdwrap{grid-area:command;min-width:0}.term .actions{grid-area:actions;min-width:0;flex-wrap:wrap}
.term .cmdwrap{gap:5px;align-items:center}
.term .opbadge,.term .riskbadge{font:700 11px/1.4 'Google Sans Code',monospace;padding:1px 5px;border-radius:5px;margin-top:0;letter-spacing:0}
.term .cmdtext{font-size:14px;line-height:1.5}
.term .meta{font-size:13px;padding:6px 8px}
.term pre{font:14px/1.5 'Google Sans Code',monospace;padding:8px 10px}
.term .actions{gap:4px}
.term .actions .btn{font:500 12px 'Google Sans Code',monospace;padding:4px 6px;gap:4px}
.term .actions .mi{width:13px;height:13px}
.term .resultline{font-size:13.5px}\n@media(max-width:800px){.term .commandrow{grid-template-columns:minmax(0,1fr);grid-template-areas:"lead" "command" "actions"}.term .cmdwrap,.term .actions{min-width:0;grid-column:1/-1}.term .joblead{grid-column:1/-1;flex-wrap:wrap}}

 /* Distribution-like outlined interactions: no underlined controls, hover border rather than label shift */
 :where(a,button,.btn,.tab,[role="button"],input[type="submit"]){text-decoration:none!important}
 :where(.btn,.tab,button,[role="button"],input[type="submit"],.sidebar-toggle){transition:border-color .16s ease,background-color .16s ease,color .16s ease}
 :where(.btn,.tab,button,[role="button"],input[type="submit"],.sidebar-toggle]):not(:disabled):not([aria-disabled="true"]):hover{border-color:#67b9e4!important;text-decoration:none!important}
 :where(.danger,.btn.danger,button[data-danger]):not(:disabled):hover{border-color:#ff8791!important}
 .wall-native-dialog button[data-confirm]:not(:disabled):hover,.ab2-shell .btn.primary:not(:disabled):hover{border-color:#ffdf60!important}
 :where(.btn,.tab,button,[role="button"],input[type="submit"],.sidebar-toggle]):focus-visible{outline:2px solid #6cbce7;outline-offset:2px}
 @media(prefers-reduced-motion:reduce){:where(.btn,.tab,button,[role="button"],input[type="submit"],.sidebar-toggle){transition:none}}
 #conn.ok{color:#62d991}
 #conn.running{color:#f2c161}
 #conn.error{color:#ff858b}
 #conn.error::before{background:#ff737a}
 #conn.running::before{background:#f2c161;animation:none}

#ptyOutput.pty-screen{min-height:0;min-width:0;padding:0;overflow:hidden;white-space:normal;word-break:normal;background:#06090d;display:flex;flex-direction:column}
#ptyOutput .xterm{width:100%;min-height:0;flex:1}
#ptyOutput .xterm-viewport{overscroll-behavior:contain}

@media(max-width:870px){body .wrap{margin-left:calc(var(--wall-sidebar-width) + 7px);margin-right:6px;max-width:calc(100% - var(--wall-sidebar-width) - 13px)}.top{align-items:flex-start}.topright{justify-content:flex-start}.term .commandrow{grid-template-columns:58px 1fr}.term .cmdwrap{grid-column:1/-1}.term .actions{grid-column:1/-1}}
@media(max-width:540px){body{--wall-sidebar-width:63px}.wall-sidebar{padding:7px}.wall-sidebar .sidebar-items .btn span,.wall-sidebar .sidebar-toggle .nav-label{display:none}.wall-sidebar .sidebar-items .btn{justify-content:center;padding:8px}.wall-sidebar .sidebar-toggle{justify-content:center}.topright .wall-notification{margin-left:0}}
`;
export const WALL_UI_REFINEMENT_SCRIPT = `
(function(){
 const sidebar=document.getElementById('wallSidebar'),toggle=document.getElementById('sidebarToggle');
 if(!sidebar||!toggle)return;
 let collapsed=false;try{collapsed=localStorage.getItem('lr-wall-sidebar-collapsed')==='1'}catch{}
 const apply=()=>{
  document.body.classList.toggle('wall-sidebar-collapsed',collapsed);
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation');
  toggle.title=collapsed?'Expand navigation':'Collapse navigation';
  for(const el of sidebar.querySelectorAll('a,button')){
   if(el===toggle)continue;
   const label=el.querySelector('span')?.textContent?.trim()||el.textContent?.trim();
   if(label&&!el.title)el.title=label;
  }
 };
 toggle.addEventListener('click',()=>{collapsed=!collapsed;try{localStorage.setItem('lr-wall-sidebar-collapsed',collapsed?'1':'0')}catch{}apply()});
 apply();
})();
`;

export const WALL_NATIVE_DIALOG_MARKUP = '<dialog id="wallNativeConfirm" class="wall-native-dialog" aria-label="Confirm access"><p id="wallNativeConfirmText"></p><div class="wall-dialog-actions"><button type="button" data-cancel>Cancel</button><button type="button" data-confirm>Confirm</button></div></dialog>';
export const WALL_NATIVE_DIALOG_SCRIPT = `
(function(){
  const dialog=document.getElementById('wallNativeConfirm');
  if(!dialog)return;
  let resolvePending=null;
  window.lrWebConfirm=(message)=>{
    if(resolvePending||typeof dialog.showModal!=='function')return Promise.resolve(false);
    const text=document.getElementById('wallNativeConfirmText');
    text.textContent=String(message||'Please confirm this action.').slice(0,300);
    return new Promise(resolve=>{
      resolvePending=resolve;
      dialog.showModal();
    });
  };
  const finish=(ok)=>{
    if(!resolvePending)return;
    const settle=resolvePending;resolvePending=null;
    if(dialog.open)dialog.close();
    settle(ok);
  };
  dialog.querySelector('[data-confirm]').addEventListener('click',()=>finish(true));
  dialog.querySelector('[data-cancel]').addEventListener('click',()=>finish(false));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
})();
`;
export function decorateWallSubpage(html,{csrf='',authEnabled=false,moduleSupported=false,materialIcon,path='/'}={}){
  if(typeof html!=='string'||!html.includes('</body>')||!html.includes('</style>'))throw Error('wall_subpage_html_contract');
  const esc=value=>String(value||'').replace(/[&<>"']/g,ch=>ch==='&'?'&amp;':ch==='<'?'&lt;':ch==='>'?'&gt;':ch==='"'?'&quot;':'&#39;');
  const icons={wall:'dashboard',connect:'link',disconnect:'power',permissions:'security',approve:'approve',memory:'folder',codex:'smart_toy',settings:'settings',logout:'logout'};
  const anchor=(href,icon,label)=>
   '<a class="btn" href="'+href+'" data-wall-current="'+String(path===href)+'" title="'+label+'">'+materialIcon(icons[icon])+'<span>'+label+'</span></a>';
  let nav=anchor('/','wall','Wall')+
   anchor('/#connectCloud','connect','Connect')+
   anchor('/#disconnectCloud','disconnect','Disconnect')+
   anchor('/permissions','permissions','Permissions')+
   anchor('/approve','approve','Approve B');
  if(moduleSupported)nav+=anchor('/long-memory','memory','Long Memory')+anchor('/codex-cli','codex','Codex');
  nav+=anchor('/settings','settings','Settings');
  if(authEnabled)nav+='<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="'+esc(csrf)+'"><button type="submit" class="btn" title="Logout">'+materialIcon('logout')+'<span>Logout</span></button></form>';
  const sidebar='<aside id="wallSidebar" class="wall-sidebar" aria-label="Wall navigation"><button class="sidebar-toggle" id="sidebarToggle" type="button" aria-expanded="true"><span class="nav-menu-glyph">☰</span><span class="nav-label">Navigation</span></button><nav class="sidebar-items">'+nav+'</nav></aside>';
  let out=html.replace('</style>',WALL_UI_REFINEMENT_CSS+WALL_SUBPAGE_FULLWIDTH_CSS+'</style>');
  out=out.replace(/<body([^>]*)>/i,(_m,attributes)=>'<body'+attributes.replace(/class="([^"]*)"/g,'')+' class="wall-subpage wall-'+esc(path.replace(/[^a-z]/g,'')||'home')+'">');
  out=out.replace(/<a\b[^>]*href="\/"[^>]*>[\s\S]*?<\/a>/gi,link=>{
    const label=link.replace(/<svg[\s\S]*?<\/svg>/gi,'').replace(/<[^>]*>/g,'').trim();
    return /^(?:back to wall|wall)$/i.test(label)?'':link;
  }); // Preserve Cancel and other functional actions
  out=out.replace(/<body[^>]*>/i,match=>match+sidebar+WALL_NATIVE_DIALOG_MARKUP);
  out=out.replace('</body>','<script>'+WALL_UI_REFINEMENT_SCRIPT+WALL_NATIVE_DIALOG_SCRIPT+'</script></body>');
  return out;
}

export const WALL_SUBPAGE_FULLWIDTH_CSS = `body.wall-subpage .wrap{width:auto;max-width:none!important;margin:16px 14px 16px calc(var(--wall-sidebar-width) + 12px)!important;padding:0!important;transform:none!important}
body.wall-subpage .wrap>.card{width:100%;max-width:none}
body.wall-subpage .wrap .brand{margin:0 0 14px}
body.wall-subpage.wall-sidebar-collapsed .wrap{margin-left:calc(var(--wall-sidebar-width) + 12px)!important}
body.wall-subpage .card{max-width:none}
@media(max-width:640px){body.wall-subpage .wrap{margin-right:7px!important;margin-left:calc(var(--wall-sidebar-width) + 7px)!important}}
`;
