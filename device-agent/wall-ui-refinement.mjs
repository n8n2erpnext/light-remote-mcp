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
.ab-v2-status #abV2ApproveLink{border:1px solid #276442;border-radius:5px;color:#90f3b9;text-decoration:none;padding:2px 6px;font-size:12px}
.ab-v2-status [hidden]{display:none!important}
.term{font-family:'Google Sans Code',ui-monospace,monospace}
.term .head{font-size:12px;font-weight:650;padding:8px 10px}
.term #jobs{padding:5px}
.term .job{margin:5px 0}
.term .commandrow{grid-template-columns:52px 74px minmax(220px,1fr) auto;gap:8px;padding:8px;align-items:center;font-size:12px}
.term .cmdwrap{gap:5px;align-items:center}
.term .opbadge,.term .riskbadge{font:700 10px/1.4 'Google Sans Code',monospace;padding:1px 5px;border-radius:5px;margin-top:0;letter-spacing:0}
.term .cmdtext{font-size:12.5px;line-height:1.5}
.term .meta{font-size:11.5px;padding:6px 8px}
.term pre{font:12.5px/1.5 'Google Sans Code',monospace;padding:8px 10px}
.term .actions{gap:4px}
.term .actions .btn{font:500 11px 'Google Sans Code',monospace;padding:4px 6px;gap:4px}
.term .actions .mi{width:13px;height:13px}
.term .resultline{font-size:12px}
@media(max-width:870px){body .wrap{margin-left:calc(var(--wall-sidebar-width) + 7px);margin-right:6px;max-width:calc(100% - var(--wall-sidebar-width) - 13px)}.top{align-items:flex-start}.topright{justify-content:flex-start}.term .commandrow{grid-template-columns:52px 1fr}.term .cmdwrap{grid-column:1/-1}.term .actions{grid-column:1/-1}}
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
