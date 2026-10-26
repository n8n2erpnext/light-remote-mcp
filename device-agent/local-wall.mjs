import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { LOCAL_WALL_COOKIE } from './local-wall-auth.mjs';
import { createWallStatusCache } from './wall-status-cache.mjs';
import { localProcessPage } from './local-process-page.mjs';
import { updateSettingsHtml } from './update-settings-page.mjs';
import { brandFaviconSvg } from '../lib/brand.mjs';
import { materialIcon } from '../lib/material-icon.mjs';
import { WALL_FONT_FACE_CSS, WALL_UI_FONT, WALL_CODE_FONT } from '../lib/web-typography.mjs';

const DEFAULT_CASCADIA_MONO_FONT=fileURLToPath(new URL('../assets/fonts/CascadiaMono.ttf',import.meta.url));
const DEFAULT_CASCADIA_CODE_FONT=fileURLToPath(new URL('../assets/fonts/web/CascadiaCode.ttf',import.meta.url));

function json(res,status,value){
  const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(body);
}
function body(req,limit=16*1024){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('body_too_large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);});}
function loadBrand(path){try{return fs.readFileSync(path,'utf8');}catch{return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#ffcc00"/><text x="32" y="40" text-anchor="middle" font-size="24" font-weight="800" fill="#080a0c">LR</text></svg>';}}
function normalizeCode(value){return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');}
export function isAllowedLocalWallBindHost(host){
  const h=String(host||'').trim();
  if(['127.0.0.1','::1','localhost'].includes(h)) return true;
  if(net.isIP(h)!==4) return false;
  const [a,b]=h.split('.').map(Number);
  return a===10 || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127);
}
function pageHeaders(){return {'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function safeNext(value){const text=String(value||'').trim();return text.startsWith('/')&&!text.startsWith('//')&&text.length<=512?text:'/';}
function secureRequest(req){return Boolean(req.socket?.encrypted)||String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase()==='https';}
function sessionCookie(token,ttl,secure){return `${LOCAL_WALL_COOKIE}=${token}; Path=/; Max-Age=${ttl}; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Priority=High`;}
function clearSessionCookie(secure){return `${LOCAL_WALL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Priority=High`;}
function loginPage(brandSvg,message='',next='/',recoveryEnabled=true,csrf=''){const note=message?`<div class=\"error\">${String(message).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]))}</div>`:'';const n=safeNext(next).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));return `<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">${brandFaviconSvg()}<title>Light Remote — Wall login</title><style>${WALL_FONT_FACE_CSS}:root{color-scheme:dark;font-family:${WALL_UI_FONT};background:#080a0c;color:#d8dee7}body{margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(420px,calc(100vw - 32px));border:1px solid #252d36;border-radius:12px;background:#0a0e12;padding:22px}.brand{display:flex;align-items:center;gap:12px}.brand svg{width:44px;height:44px}.muted{color:#718096}.error{color:#ff8e8e;margin-top:12px}label{display:block;margin-top:14px}input,button{width:100%;margin-top:6px;border:1px solid #2b333d;background:#0e1216;color:#d8dee7;border-radius:7px;padding:10px;font:inherit;box-sizing:border-box}button{cursor:pointer;margin-top:18px}</style></head><body><main class=\"card\"><div class=\"brand\"><span>${brandSvg}</span><div><b>Light Remote</b><div class=\"muted\">Device Wall login</div></div></div>${note}<form method=\"post\" action=\"/auth/login\"><input type=\"hidden\" name=\"next\" value=\"${n}\"><input type=\"hidden\" name=\"csrf\" value=\"${csrf}\"><label>Email / recovery username<input name=\"username\" autocomplete=\"username\" required autofocus></label>${recoveryEnabled?'<div class="muted" style="font-size:11px;margin-top:7px;line-height:1.4">Use your Light Remote account email. Recovery login remains available with the local device credential.</div>':'<div class="muted" style="font-size:11px;margin-top:7px;line-height:1.4">Use your Light Remote account email.</div>'}<label>Password<input type=\"password\" name=\"password\" autocomplete=\"current-password\" required></label><button type=\"submit\">Sign in</button></form></main></body></html>`;}
export function classifyLocalWallLoginFailure(error) {
  const code=String(error?.message||'');
  const status=Number(error?.status)||0;
  if(code==='device_account_mismatch') return {status:409,reason:'device_account_mismatch',credentialFailure:false,message:'This device is linked to a different Light Remote account. Re-enroll the device using your Light Remote client; on macOS, choose Relink this Mac from the tray menu. Approve the new device code while signed in to your intended account.'};
  if(code==='rate_limited'||status===429) return {status:429,reason:'rate_limited',credentialFailure:false,retryAfterSeconds:900,message:'Too many sign-in attempts. Wait a few minutes before retrying.'};
  if(code==='account_admin_disabled') return {status:403,reason:'account_admin_disabled',credentialFailure:false,message:'This account is disabled. Contact Light Remote support.'};
  if(code==='invalid_account_credentials'||status===401) return {status:401,reason:'invalid_account_credentials',credentialFailure:true,message:'Invalid email or password.'};
  return {status:503,reason:'account_service_unavailable',credentialFailure:false,message:'Account sign-in is temporarily unavailable. Check your network connection and try again.'};
}
function formBody(req,limit=16*1024){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('body_too_large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));}catch{reject(new Error('invalid_form'));}});req.on('error',reject);});}


function wallPage(brandSvg,authEnabled=false,csrf='',identity=null,moduleSupported=false,view='home'){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${brandFaviconSvg()}<title>Light Remote MCP — Device Wall</title><style>
${WALL_FONT_FACE_CSS}:root{color-scheme:dark;font-family:${WALL_UI_FONT};background:#080a0c;color:#d8dee7}*{box-sizing:border-box}body{margin:0;background:#080a0c}.wrap{max-width:1500px;margin:auto;padding:16px}.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}.brand{display:flex;align-items:center;gap:11px}.brand svg{width:44px;height:44px}.brand strong{font-size:19px;color:#f3f4f6}.brand small{font-size:10px;letter-spacing:.16em;color:#718096}.muted{color:#718096}.pill,.btn,input,select,.tab{border:1px solid #2b333d;background:#0e1216;color:#cfd7e3;border-radius:7px;padding:7px 9px;font:inherit}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;cursor:pointer}.mi{width:16px;height:16px;fill:currentColor;flex:0 0 auto}.ok{color:#78d78b}.hold,.running{color:#e6c36b}.error{color:#ff8e8e}.timeout{color:#ffb56b}.controls,.tabs,.topright{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.paircontrol{display:flex;align-items:center;border:1px solid #2b333d;background:#0e1216;border-radius:7px;overflow:hidden;min-height:34px}.pairprefix{padding:0 0 0 9px;color:#aeb8c5;font-weight:700}.paircode{font-family:${WALL_CODE_FONT};letter-spacing:.12em;font-weight:800;color:#ffcc00;padding:0 8px;min-width:9.5em;display:inline-block}.code-exp{font-family:${WALL_CODE_FONT};font-size:10px;color:#718096;font-variant-numeric:tabular-nums;padding-right:4px}.icon-only{width:34px;height:34px;padding:0;border:0;border-left:1px solid #2b333d;border-radius:0;background:transparent;color:#aeb8c5}.icon-only:hover{background:#151b22;color:#f3f4f6}.eye-off{display:none}.revealed .eye-open{display:none}.revealed .eye-off{display:inline-flex}.btn:disabled,.icon-only:disabled{opacity:.45;cursor:not-allowed}.tabs{margin-top:12px;overflow:auto;flex-wrap:nowrap;padding-bottom:3px}.tab{cursor:pointer;white-space:nowrap}.tab.active{background:#1a222b;border-color:#61758a}.tab .state{margin-left:6px;font-size:11px}.sessionbox{margin-top:9px;border:1px solid #202832;background:#0a0e12;border-radius:8px;padding:9px 11px;font-size:12px;line-height:1.5}.term{margin-top:10px;border:1px solid #252d36;border-radius:10px;background:#050708;overflow:hidden}.head{padding:9px 12px;border-bottom:1px solid #20262d;display:flex;justify-content:space-between;gap:10px}#jobs{max-height:78vh;overflow:auto;padding:8px}.job{border:1px solid #171d23;border-radius:8px;margin:7px 0;background:#090c0f}.job.hidden{display:none}.commandrow{display:grid;grid-template-columns:70px 82px minmax(220px,1fr) auto;gap:10px;padding:10px;align-items:start;border-bottom:1px solid #151a20}.cmdwrap{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;min-width:0}.opbadge{border:1px solid #40505f;background:#111922;color:#9fd0ff;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:800;letter-spacing:.05em;white-space:nowrap;margin-top:2px}.opbadge.op-fs{border-color:#236b7a;background:#0b2228;color:#67e8f9}.opbadge.op-search{border-color:#246b46;background:#0c2117;color:#75e6a4}.opbadge.op-runtime{border-color:#7a5723;background:#24190a;color:#f3bd61}.opbadge.op-neutral{border-color:#a8afb7;background:#d7dbe0;color:#0a0c0f}.riskbadge{border-radius:999px;padding:2px 7px;font-size:10px;font-weight:900;letter-spacing:.05em;white-space:nowrap;margin-top:2px}.risk-yellow{border:1px solid #8b741f;background:#2a2308;color:#ffe066}.risk-red{border:1px solid #8f3232;background:#2a0c0c;color:#ff8e8e}.cmdtext{font-family:${WALL_CODE_FONT};color:#CCCCCC;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;min-width:0}.syn-command{color:#16C60C;font-weight:700}.syn-danger-command{color:#E74856;font-weight:800}.syn-option{color:#61D6D6}.syn-string{color:#F9F1A5}.syn-path{color:#3B78FF}.syn-var{color:#B4009E}.syn-op{color:#F2F2F2;font-weight:700}.syn-keyword{color:#B4009E}.syn-comment{color:#767676;font-style:italic}.syn-number{color:#3A96DD}.resultline{display:block;color:#9fb0c2;font-size:11px;line-height:1.45;margin-top:4px}.meta{font-family:${WALL_CODE_FONT};padding:8px 10px;color:#8390a1;font-size:12px;white-space:pre-wrap}pre{font-family:${WALL_CODE_FONT};margin:0;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;max-height:46vh;overflow:auto}.stderr{color:#ffb0b0}.actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.small{font-size:11px;padding:5px 7px}.note{margin-top:8px;font-size:11px;color:#667282}.btn.danger{border-color:#6e3434;color:#ff9ba5}.toasts{position:fixed;top:14px;right:14px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none}.toast{min-width:180px;max-width:min(420px,calc(100vw - 28px));border:1px solid #46515c;background:#111820;color:#e7edf4;border-radius:8px;padding:9px 11px;font-size:11px;box-shadow:0 8px 28px #0008;opacity:0;transform:translateY(-5px);transition:opacity .14s ease,transform .14s ease}.toast.show{opacity:1;transform:translateY(0)}.toast.ok{border-color:#2c7145}.toast.error{border-color:#873c3c;color:#ffb1b1}.toast.info{border-color:#52697f}.confirm-overlay{position:fixed;inset:0;z-index:9999;background:#0009;display:none;place-items:center;padding:18px}.confirm-overlay.show{display:grid}.confirm-card{width:min(520px,100%);border:1px solid #38434f;background:#0b1015;border-radius:10px;padding:16px}.confirm-text{line-height:1.5;margin-bottom:14px}.confirm-actions{display:flex;justify-content:flex-end;gap:8px}.pty-overlay{display:none;position:fixed;inset:0;z-index:9998;background:#000c;place-items:center;padding:18px}.pty-overlay.show{display:grid}.pty-card{width:min(1050px,100%);height:min(85vh,900px);display:flex;flex-direction:column;border:1px solid #34495b;border-radius:11px;background:#0b1015;padding:12px;gap:10px}.pty-bar{display:flex;align-items:center;justify-content:space-between;gap:8px}.pty-detail{display:flex;gap:10px;min-height:0;flex:1}.pty-list{width:240px;overflow:auto;display:flex;gap:5px;flex-direction:column}.pty-list button{text-align:left;justify-content:flex-start;overflow-wrap:anywhere}.pty-screen{min-width:0;flex:1;background:#040608;border:1px solid #242e38;border-radius:7px;padding:12px;white-space:pre-wrap;word-break:break-word;overflow:auto;font:12px/1.55 ${WALL_CODE_FONT};color:#cee8da}.pty-warning{font-size:11px;color:#c0a77d}.pty-title{font-size:12px;color:#cddce9}@media(max-width:680px){.pty-detail{flex-direction:column}.pty-list{width:auto;max-height:125px}.pty-screen{min-height:0}}
/* Floating, local-only PTY console: never blocks the Wall behind it. */
.pty-overlay{background:transparent;place-items:initial;padding:0;pointer-events:none}
.pty-overlay.show{display:block}
.pty-card{position:fixed;left:auto;top:auto;right:22px;bottom:22px;width:min(760px,calc(100vw - 24px));height:min(530px,calc(100dvh - 24px));min-width:300px;min-height:185px;max-width:calc(100vw - 12px);max-height:calc(100dvh - 12px);padding:10px;resize:both;overflow:hidden;pointer-events:auto;box-shadow:0 20px 55px #000a}
.pty-bar{cursor:grab;touch-action:none;user-select:none;padding:3px 2px 7px;border-bottom:1px solid #202b35}
.pty-bar:active{cursor:grabbing}
.pty-bar .actions{cursor:default;flex-wrap:nowrap}
.pty-heading{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
.pty-heading .mi{width:16px;height:16px;display:inline-block;flex:none}
.pty-heading .pty-grip{color:#8997a7;opacity:.75}
.pty-heading .pty-readonly{color:#90c8de;font-size:10px;white-space:nowrap}
.pty-launcher{position:fixed;right:22px;bottom:20px;z-index:9997;background:#102c39;color:#c3efff;border-color:#246478;border-radius:999px;padding:11px 14px;box-shadow:0 5px 25px #000b;font-weight:700}
.pty-launcher .mi,.pty-bar .mi{width:16px;height:16px;display:inline-block;flex:0 0 auto}
.pty-launcher[hidden]{display:none}
.pty-bar button{display:inline-flex;align-items:center;gap:5px}
.pty-overlay.minimized .pty-card{height:auto!important;min-height:0;resize:none;width:min(375px,calc(100vw - 18px))!important}
.pty-overlay.minimized .pty-warning,.pty-overlay.minimized .pty-title,.pty-overlay.minimized .pty-detail{display:none}
.pty-overlay.minimized .pty-bar{border-bottom:0;padding-bottom:2px}
.pty-overlay.minimized #ptyRefresh{display:none}.pty-expand-icon{display:none}.pty-overlay.minimized .pty-expand-icon{display:inline-flex}.pty-overlay.minimized .pty-minimize-icon{display:none}
.pty-detail{min-height:0;flex:1}
.pty-screen{min-height:0}
@media(max-width:680px){.pty-card{min-width:0;max-width:calc(100vw - 12px);min-height:160px}.pty-list{max-height:125px}.pty-launcher{right:12px;bottom:12px}.pty-heading .pty-grip{display:none}}
.scp-inline-progress{display:inline-block;margin-left:9px;font-family:${WALL_CODE_FONT};font-size:11px;line-height:1.45;white-space:pre-wrap;color:#8dc9df;font-variant-numeric:tabular-nums;vertical-align:baseline}.scp-inline-progress strong{color:#a3e5ac;font-weight:800}@media(max-width:800px){.scp-inline-progress{margin-left:0;display:block}}@keyframes lr-spin360{to{transform:rotate(360deg)}}#refreshA.spinning .mi{animation:lr-spin360 .32s ease-in-out}@media(max-width:800px){.wrap{padding:9px}.commandrow{grid-template-columns:64px 1fr}.cmdtext{grid-column:1/-1}.actions{grid-column:1/-1}.meta{font-size:11px}}
body.wall-view-home #goldModulesPanel{display:none}
body.wall-view-memory .wall-primary,body.wall-view-codex .wall-primary{display:none}
body.wall-view-memory #goldCodexArea,body.wall-view-codex #goldMemoryArea{display:none}
body.wall-view-memory #goldCodexToggleLabel,body.wall-view-codex #goldMemoryToggleLabel{display:none}
body.wall-view-memory #goldModulesPanel>summary,body.wall-view-codex #goldModulesPanel>summary{display:none}
body.wall-view-memory #ptyOpen,body.wall-view-codex #ptyOpen{display:none}
.module-nav-status{font-size:10px;border-radius:5px;padding:2px 4px;background:#303943;color:#abbccc}
.module-nav-status.on{background:#123627;color:#7ee8ad}
</style></head><body class="wall-view-${view}"><div id="toastHost" class="toasts" aria-live="polite"></div><div id="confirmOverlay" class="confirm-overlay" role="dialog" aria-modal="true" aria-hidden="true"><div class="confirm-card"><div id="confirmText" class="confirm-text"></div><div class="confirm-actions"><button id="confirmCancel" class="btn small" type="button">Cancel</button><button id="confirmOk" class="btn small danger" type="button">Confirm</button></div></div></div><div class="wrap"><div class="top"><div><div class="brand"><span>${brandSvg}</span><span><strong>Light Remote</strong> <small>MCP</small></span></div><div class="muted" style="margin-top:6px">Local Wall · one device · session lanes · operator history</div></div><div class="topright">${view==='home'?'':'<a id="backToWall" class="btn small" href="/" aria-label="Back to Wall">'+materialIcon('arrowBack')+'<span>Back to Wall</span></a>'}<span id="conn" class="pill">connecting…</span><span class="paircontrol"><span class="pairprefix">A</span><span id="acode" class="paircode">••••-••••</span><span id="aexp" class="code-exp">--:--</span><button id="toggleA" class="icon-only" type="button" title="Show A" aria-label="Show A" disabled><span class="eye-open">${materialIcon('visibility')}</span><span class="eye-off">${materialIcon('visibilityOff')}</span></button><button id="copyA" class="icon-only" type="button" title="Copy A" aria-label="Copy A" disabled>${materialIcon('copy')}</button><button id="refreshA" class="icon-only" type="button" title="Refresh A" aria-label="Refresh A">${materialIcon('refresh')}</button></span><button id="connectCloud" class="btn small">${materialIcon('link')}<span>Connect</span></button><button id="disconnectCloud" class="btn small">${materialIcon('power')}<span>Disconnect</span></button><button id="linkDevice" class="btn small" style="display:none">${materialIcon('device')}<span class="label">Link device</span></button><span id="deviceCodeWrap" class="pill" style="display:none">Device <span id="deviceCode" class="paircode">—</span> <span id="deviceCodeExp" class="muted"></span></span><button id="copyDeviceCode" class="btn small" style="display:none" disabled>${materialIcon('copy')}<span>Copy code</span></button><span id="enrollMsg" class="muted"></span><a id="fleetWall" class="btn small" href="#" target="_blank" rel="noopener" style="display:none">${materialIcon('device')}<span>Open Fleet Wall</span></a><a class="btn small" href="/processes">${materialIcon("terminal")}<span>Processes</span></a><a class="btn small" href="/permissions">${materialIcon('security')}<span>Permissions</span></a><a class="btn small" href="/approve">${materialIcon('approve')}<span>Approve B</span></a>${moduleSupported?'<a class="btn small" href="/long-memory">'+materialIcon("folder")+'<span>Long Memory</span> <span id="navMemoryState" class="module-nav-status">…</span></a><a class="btn small" href="/codex-cli">'+materialIcon("terminal")+'<span>Codex</span> <span id="navCodexState" class="module-nav-status">…</span></a>':''}<a class="btn small" href="/settings">${materialIcon('settings')}<span>Settings</span></a>${authEnabled?'<form method="post" action="/auth/logout" style="margin:0"><input type="hidden" name="csrf" value="'+csrf+'"><button class="btn small" type="submit">'+materialIcon('logout')+'<span>Logout</span></button></form>':''}</div></div>

<div class="wall-primary"><div id="devicebox" class="sessionbox muted">loading device…</div><div id="abGrantTimer" class="muted" style="margin:5px 0">Agent A/B access · checking…</div><div id="tabs" class="tabs"></div><div id="sessionbox" class="sessionbox muted">loading sessions…</div><div id="sessionActions" class="controls" style="margin-top:7px"></div>
<div class="controls" style="margin-top:9px"><input id="filter" placeholder="filter cwd / command / output / PTY"><select id="status"><option value="">all status</option><option>running</option><option>ok</option><option>error</option><option>timeout</option></select><button id="pause" class="btn">${materialIcon('pause')}<span>Pause</span></button><button id="copyVisible" class="btn">${materialIcon('copy')}<span>Copy visible</span></button></div>
</div>
${moduleSupported?"<details id=\"goldModulesPanel\" class=\"sessionbox\" style=\"margin:12px 0;padding:11px;border:1px solid #293844;border-radius:9px\">\n  <summary style=\"cursor:pointer;font-weight:700\">Long Memory &amp; Codex Bridge <span class=\"muted\" style=\"font-size:12px\">\u00b7 <span id=\"goldModulesLiveSummary\" aria-live=\"polite\">Loading current state\u2026</span></span></summary>\n  <p class=\"muted\" style=\"font-size:12px\">Built into this device's Gold Wall. Local data only; no Project or second Account. Enabling a module does not automatically authorize remote access.</p>\n  <div class=\"controls\" style=\"align-items:center;gap:18px;flex-wrap:wrap\">\n    <label id=\"goldMemoryToggleLabel\"><input id=\"goldLongMemory\" type=\"checkbox\"> Long Memory</label>\n    <label id=\"goldCodexToggleLabel\"><input id=\"goldCodexBridge\" type=\"checkbox\"> Codex Bridge</label>\n    <button class=\"btn small\" type=\"button\" id=\"goldModulesSave\">Save modules</button>\n    <span id=\"goldModulesStatus\" class=\"muted\" role=\"status\">Loading modules\u2026</span>\n  </div>\n  <div id=\"goldMemoryArea\" hidden>\n    <div id=\"goldSimpleSyncPanel\" style=\"margin:0 0 14px;padding:12px;border:1px solid #304158;border-radius:9px\">\n        <strong>Memory Sync</strong>\n        <p class=\"muted\" style=\"font-size:12px\">Select which enrolled account devices may participate, then set an independent sync mode for each: Auto, Follow Project, or Manual. This account-wide setting is consistent across all Device Walls. Each memory scope retains its own authoritative Home; memory content stays on your devices. Device Auto controls transfer; it does NOT auto-capture chat or change a scope's capture mode.</p>\n        <div style=\"display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:12px 0\">\n          <label style=\"font-weight:650\"><input type=\"checkbox\" id=\"goldSimpleSyncEnabled\"> Sync ON</label>\n          <span id=\"goldSimpleSyncState\" class=\"muted\" role=\"status\">Loading account devices…</span>\n          <span id=\"goldSimpleSyncVerified\" class=\"muted\" role=\"status\">Last verified sync: checking…</span>\n        </div>\n        <div id=\"goldSimpleSyncDevices\" style=\"display:grid;gap:6px;max-width:690px\"></div>\n        <p class=\"muted\" style=\"font-size:11px;margin-top:8px\">Sync OFF pauses transfers without deleting local history. Deselecting a device stops new updates to it. Follow Project syncs only verified project-bound scopes; Manual syncs only when you select Sync now.</p>\n    </div>\n    <section id=\"goldMemoryReader\" style=\"margin:0 0 14px;padding:12px;border:1px solid #304158;border-radius:9px\">\n      <strong>Memory Library · Read &amp; Export</strong>\n      <p class=\"muted\" style=\"font-size:12px\">Read verified checkpoint content stored on this device. Exports contain sensitive project history; files are saved only when you select Download. This does not trigger Sync or modify Memory.</p>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <select id=\"goldReaderScope\" aria-label=\"Memory scope to read\" style=\"min-width:260px\"><option value=\"\">Choose a memory scope</option></select>\n        <button type=\"button\" class=\"btn small\" id=\"goldReaderRead\">Read memory</button>\n        <button type=\"button\" class=\"btn small\" id=\"goldReaderExportJson\">Export JSON</button>\n        <button type=\"button\" class=\"btn small\" id=\"goldReaderExportMd\">Export Markdown</button>\n        <button type=\"button\" class=\"btn small\" id=\"goldReaderManage\">Manage scope</button>\n      </div>\n      <div id=\"goldReaderManagePanel\" hidden style=\"padding:10px;margin:8px 0;border:1px solid #374958;border-radius:8px\">\n        <div class=\"controls\" style=\"flex-wrap:wrap\">\n          <button type=\"button\" class=\"btn small\" id=\"goldReaderArchive\">Archive scope</button>\n          <button type=\"button\" class=\"btn small\" id=\"goldReaderDeleteLocal\">Delete on this device</button>\n          <button type=\"button\" class=\"btn small\" id=\"goldReaderDeleteAccount\" disabled title=\"Requires signed tombstones and acknowledgment by all enrolled offline devices\">Delete across account · coming later</button>\n        </div>\n        <div id=\"goldReaderManageStatus\" role=\"status\" class=\"muted\" style=\"font-size:12px\">Archiving preserves signed history; local deletion does not erase Replica copies.</div>\n        <div class=\"controls\" style=\"flex-wrap:wrap\">\n          <select id=\"goldReaderArchived\" aria-label=\"Archived scopes\"><option value=\"\">Archived scopes</option></select>\n          <button type=\"button\" id=\"goldReaderRestore\" class=\"btn small\">Restore archived scope</button>\n        </div>\n      </div>\n      <div id=\"goldReaderUsage\" role=\"status\" class=\"muted\" style=\"font-size:12px\">Loading local storage and verified sync timestamps…</div>\n      <div id=\"goldContextCapture\" style=\"padding:10px;margin:8px 0;border:1px solid #304158;border-radius:8px\">\n        <strong>Complete context · Owner opt-in</strong>\n        <p class=\"muted\" style=\"font-size:12px\">Optional: save a full transcript, handoff or project context that you explicitly paste/upload. Light Remote cannot invisibly read ChatGPT browser conversations. Each accepted snapshot is signed on its Home device.</p>\n        <label><input id=\"goldContextOptIn\" type=\"checkbox\"> Allow full-context snapshots for this scope</label>\n        <div class=\"controls\" style=\"flex-wrap:wrap\">\n          <input id=\"goldContextTitle\" maxlength=\"140\" placeholder=\"Context title / session\" style=\"min-width:220px\">\n          <input id=\"goldContextFile\" type=\"file\" accept=\".txt,.md,.json,text/plain,text/markdown,application/json\" aria-label=\"Import your own transcript or context file\">\n          <button id=\"goldContextSave\" class=\"btn small\" type=\"button\">Save complete context</button>\n          <button id=\"goldContextRead\" class=\"btn small\" type=\"button\">Read verified restore context</button>\n        </div>\n        <textarea id=\"goldContextText\" rows=\"5\" maxlength=\"524288\" placeholder=\"Paste the complete context you want available in future sessions\" style=\"width:100%;resize:vertical;background:#0c1219;color:#d8dee7;border:1px solid #304158;border-radius:6px;padding:8px\"></textarea>\n        <div class=\"muted\" id=\"goldContextStatus\" role=\"status\" style=\"font-size:12px\">Maximum 512 KiB per user-provided snapshot; no silent truncation.</div>\n      </div>\n      <div class=\"controls\" style=\"display:none\" aria-hidden=\"true\">\n      </div>\n      <div id=\"goldReaderStatus\" role=\"status\" class=\"muted\" style=\"font-size:12px\">Select a scope to read its verified history.</div>\n      <pre id=\"goldReaderPreview\" hidden style=\"white-space:pre-wrap;overflow-wrap:anywhere;max-height:270px;overflow:auto;font-size:12px\"></pre>\n    </section>\n    <details id=\"goldAdvancedMemory\"><summary>Advanced Memory settings · Scopes, notes &amp; checkpoints</summary>\n    <h3 style=\"margin-bottom:5px\">Long Memory \u00b7 Device-local notes</h3>\n    <p class=\"muted\" style=\"font-size:12px\">Notes have explicit sources; they are not verified hidden ChatGPT context. Remote cross-chat retrieval requires a separately authorized Gold Plugin integration.</p>\n    <div class=\"controls\" style=\"flex-wrap:wrap\">\n      <select id=\"goldMemoryKind\" aria-label=\"Memory kind\"><option value=\"note\">Note</option><option value=\"decision\">Decision</option><option value=\"checkpoint\">Checkpoint</option></select>\n      <input id=\"goldMemorySource\" maxlength=\"512\" placeholder=\"Source or decision reference\" style=\"min-width:220px\">\n      <button class=\"btn small\" id=\"goldMemorySave\" type=\"button\">Save local note</button>\n    </div>\n    <textarea id=\"goldMemoryBody\" maxlength=\"12000\" rows=\"3\" placeholder=\"Context worth retaining, from an attributable source\" style=\"width:100%;resize:vertical;background:#0c1219;border:1px solid #304158;color:#d8dee7;border-radius:6px;padding:8px\"></textarea>\n    <div class=\"controls\"><input id=\"goldMemoryQuery\" maxlength=\"160\" placeholder=\"Search saved memory\"><button class=\"btn small\" type=\"button\" id=\"goldMemoryFind\">Search</button></div>\n    <div id=\"goldMemoryResults\" class=\"muted\" style=\"white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto\">No notes loaded.</div>\n    <div style=\"margin-top:10px;border-top:1px solid #263442;padding-top:9px\">\n      <strong>Scoped Long Memory V2</strong>\n      <p class=\"muted\" style=\"font-size:11px\">Each scope is isolated by account and unique ID. Its authoritative Home signs checkpoints. Sync is controlled by account device selection and per-device mode; encrypted transport and scope authorization are handled automatically.</p>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <select id=\"goldScopeSelect\" aria-label=\"Active memory scope\"><option value=\"\">Choose a scope</option></select>\n        <button class=\"btn small\" type=\"button\" id=\"goldScopeRefresh\">Refresh scopes</button>\n        <span id=\"goldScopeStatus\" class=\"muted\" role=\"status\">No scope selected.</span>\n      </div>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <input id=\"goldScopeName\" maxlength=\"240\" placeholder=\"New scope name e.g. Light Remote Gold\">\n        <select id=\"goldScopeCapture\" aria-label=\"Scope capture policy\"><option value=\"manual\">Manual</option><option value=\"auto\">Auto · scoped Gold events</option><option value=\"follow_project\">Follow Project · bound workspaces</option></select>\n        <button class=\"btn small\" type=\"button\" id=\"goldScopeCreate\">Create scope</button>\n        <button class=\"btn small\" type=\"button\" id=\"goldScopeApplyMode\">Apply mode to selected scope</button>\n      </div>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <select id=\"goldScopeBindingType\" aria-label=\"Binding type\"><option value=\"workspace\">Workspace</option><option value=\"repository\">Repository</option><option value=\"work_context\">Work context</option></select>\n        <input id=\"goldScopeBindingId\" maxlength=\"1024\" placeholder=\"Exact trusted path or context identifier\" style=\"min-width:280px\">\n        <button class=\"btn small\" type=\"button\" id=\"goldScopeBind\">Bind to selected scope</button>\n      </div>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <button class=\"btn small\" type=\"button\" id=\"goldScopedSave\">Save to selected scope</button>\n        <button class=\"btn small\" type=\"button\" id=\"goldScopedHandoff\">Read scoped handoff</button>\n      </div>\n      <div style=\"margin-top:10px;border-top:1px solid #263442;padding-top:9px\">\n        <div class=\"controls\" style=\"display:none\" aria-hidden=\"true\">\n          <select id=\"goldScopeSyncPolicy\" aria-label=\"Selected scope sync policy\">\n            <option value=\"local_only\">This device only</option>\n            <option value=\"selected_devices\">Selected owner-approved devices</option>\n            <option value=\"authorized_devices\">All explicitly authorized sync devices</option>\n          </select>\n          <button class=\"btn small\" type=\"button\" id=\"goldScopeSyncApply\">Apply policy</button>\n          <button class=\"btn small\" type=\"button\" id=\"goldScopeSyncStatus\">Inspect local sync state</button>\n          <button class=\"btn small\" type=\"button\" id=\"goldSyncIdentityShow\">Show public key fingerprint</button>\n          <button class=\"btn small\" type=\"button\" id=\"goldPeerAccountDevicesRefresh\">Refresh account devices</button>\n          <div id=\"goldPeerAccountDevices\" class=\"muted\" aria-live=\"polite\" style=\"font-size:12px\">Account device directory not loaded</div>\n          <select id=\"goldSyncReplicaSelect\" aria-label=\"Choose an enrolled Replica\"><option value=\"\">Choose Replica device</option></select>\n          <label><input id=\"goldSyncOwnerConfirm\" type=\"checkbox\"> I approve this device and Scope permission change</label>\n          <button class=\"btn small\" type=\"button\" id=\"goldSyncOffer\">Authorize Replica</button>\n          <button class=\"btn small danger\" type=\"button\" id=\"goldSyncRevoke\">Revoke selected Replica</button>\n          <button class=\"btn small\" type=\"button\" id=\"goldSyncInboxRefresh\">Check sync invitations</button>\n          <div id=\"goldSyncInbox\" class=\"muted\" aria-live=\"polite\">No invitations loaded.</div>\n          <div hidden aria-hidden=\"true\"><input id=\"goldPeerHomeUrl\" maxlength=\"128\"><input id=\"goldPeerEnabled\" type=\"checkbox\"><button type=\"button\" id=\"goldPeerRouteSave\">Disabled legacy diagnostic route</button></div>\n        </div>\n        <details hidden aria-hidden=\"true\" style=\"margin-top:9px;border:1px solid #2b3d4d;padding:8px;border-radius:7px\">\n          <summary style=\"cursor:pointer\">Pair a Memory Home and Replica (owner approval)</summary>\n          <p class=\"muted\" style=\"font-size:11px\">Exchange PUBLIC identity metadata only. Compare device fingerprints on each Wall before approving. Scope records stay local; a signed invitation grants one scope, not your whole account.</p>\n          <div class=\"controls\">\n            <button class=\"btn small\" type=\"button\" id=\"goldPeerExportIdentity\">Export this device public identity</button>\n            <button class=\"btn small\" type=\"button\" id=\"goldPeerCopyIdentity\">Copy identity</button>\n          </div>\n          <textarea id=\"goldPeerMyIdentity\" rows=\"3\" readonly aria-label=\"This device public identity for the other owner-approved device\" placeholder=\"Public identity will appear here\" style=\"width:100%;resize:vertical\"></textarea>\n          <p class=\"muted\" style=\"font-size:11px\">On the Home: choose scope, paste the Replica public identity and manually verify its fingerprint.</p>\n          <textarea id=\"goldPeerCandidate\" rows=\"3\" aria-label=\"Replica public identity JSON\" placeholder=\"Paste Replica public identity JSON\" style=\"width:100%;resize:vertical\"></textarea>\n          <div class=\"controls\" style=\"flex-wrap:wrap\">\n            <input id=\"goldPeerExpectedFingerprint\" maxlength=\"64\" placeholder=\"Replica fingerprint verified separately\">\n            <button class=\"btn small\" type=\"button\" id=\"goldPeerGrant\">Grant selected scope to Replica</button>\n          </div>\n          <textarea id=\"goldPeerInviteOutput\" rows=\"4\" readonly aria-label=\"Signed invitation to copy to Replica\" placeholder=\"Signed Home invitation appears here\" style=\"width:100%;resize:vertical\"></textarea>\n          <button class=\"btn small\" type=\"button\" id=\"goldPeerCopyInvite\">Copy signed invitation</button>\n          <p class=\"muted\" style=\"font-size:11px\">On the Replica: paste the signed Home invitation, verify the Home fingerprint separately, then accept before enabling a NetBird route.</p>\n          <textarea id=\"goldPeerInviteInput\" rows=\"4\" aria-label=\"Signed Home invitation JSON\" placeholder=\"Paste signed Home invitation JSON\" style=\"width:100%;resize:vertical\"></textarea>\n          <div class=\"controls\" style=\"flex-wrap:wrap\">\n            <input id=\"goldPeerHomeFingerprint\" maxlength=\"64\" placeholder=\"Home fingerprint verified separately\">\n            <button class=\"btn small\" type=\"button\" id=\"goldPeerAccept\">Accept Home invitation</button>\n          </div>\n          <div class=\"controls\" style=\"flex-wrap:wrap\">\n            <input id=\"goldPeerRevokeDevice\" maxlength=\"160\" placeholder=\"Replica device ID for revocation\">\n            <button class=\"btn small danger\" type=\"button\" id=\"goldPeerRevoke\">Revoke selected scope grant</button>\n          </div>\n          <label><input id=\"goldPeerOwnerApproval\" type=\"checkbox\"> I own these devices, checked their fingerprints separately and authorize this scope action.</label>\n          <div class=\"muted\" id=\"goldPeerPairStatus\" role=\"status\" style=\"white-space:pre-wrap;font-size:11px\"></div>\n        </details>\n        <pre id=\"goldSyncStatusText\" style=\"white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto\"></pre>\n      </div>\n      <textarea id=\"goldScopedPreview\" rows=\"4\" style=\"width:100%\" readonly hidden aria-label=\"Verified scoped memory history\"></textarea>\n      <div style=\"margin-top:12px;border-top:1px solid #263442;padding-top:9px\">\n      <strong>Signed handoff checkpoints · Legacy V1 (unassigned)</strong>\n      <p class=\"muted\" style=\"font-size:11px\">Saved explicitly on this device with local HMAC integrity. A future authorized ChatGPT session can retrieve them through the Gold Plugin; this does not read hidden ChatGPT chat history.</p>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <input id=\"goldCheckpointTitle\" maxlength=\"240\" placeholder=\"Checkpoint title / milestone\" style=\"min-width:240px\">\n        <button class=\"btn small\" id=\"goldCheckpointSave\" type=\"button\">Save checkpoint</button>\n        <button class=\"btn small\" id=\"goldCheckpointHandoff\" type=\"button\">Preview handoff</button>\n      </div>\n      <div id=\"goldCheckpointResults\" style=\"white-space:pre-wrap;max-height:220px;overflow:auto\"></div>\n      <textarea id=\"goldHandoffPreview\" rows=\"4\" style=\"width:100%\" readonly hidden aria-label=\"Handoff for authorized next ChatGPT session\"></textarea>\n    </div>\n    </div>\n  </details>\n  </div>\n  <div id=\"goldCodexArea\" hidden>\n    <h3 style=\"margin-bottom:5px\">Codex Bridge \u00b7 Task observer</h3>\n    <p class=\"muted\" style=\"font-size:12px\">Local Task Controller plus optional ChatGPT-plan Codex observer. Does not automatically continue ChatGPT Web sessions.</p>\n    <div class=\"controls\"><input id=\"goldObserverTitle\" maxlength=\"240\" placeholder=\"Current task to observe\" style=\"min-width:230px\"><button class=\"btn small\" id=\"goldObserverAdd\" type=\"button\">Add task</button></div>\n    <div id=\"goldObserverRecommendation\" class=\"muted\">Observer inactive.</div>\n    <div id=\"goldObserverTasks\"></div>\n    <div style=\"border-top:1px solid #263442;padding-top:8px;margin-top:9px\">\n      <strong>Codex result receipts \u00b7 owner approval required</strong>\n      <p class=\"muted\" style=\"font-size:11px\">A completed observer turn does not change a task. Review a receipt and explicitly approve any task transition.</p>\n      <div id=\"goldObserverReceipts\"></div>\n    </div>\n\n    <section id=\"goldCodexPlus\" style=\"margin:12px 0 0;padding:10px;border:1px solid #293844;border-radius:7px\">\n      <strong>Codex \u00b7 Sign in with ChatGPT</strong>\n      <p class=\"muted\" style=\"font-size:12px\">Use your Codex entitlement in ChatGPT Plus/Pro. No API key, no Platform credits. Codex runs locally as an isolated app-server child. Gold owner approval remains separate.</p>\n      <div class=\"controls\" style=\"flex-wrap:wrap\"><button class=\"btn small\" type=\"button\" id=\"goldManagedCodexInstall\">Install Codex Runtime</button><button class=\"btn small\" type=\"button\" id=\"goldManagedCodexRemove\" hidden>Remove managed runtime</button><button class=\"btn small\" type=\"button\" id=\"goldManagedCodexRefresh\">Check runtime</button><span class=\"muted\" id=\"goldManagedCodexStatus\" role=\"status\">Checking device runtime…</span></div>\n      <div class=\"controls\" style=\"flex-wrap:wrap\">\n        <button class=\"btn small\" id=\"goldCodexPlusLogin\" type=\"button\">Sign in with ChatGPT</button>\n        <button class=\"btn small\" id=\"goldCodexPlusRefresh\" type=\"button\">Check sign-in</button>\n        <button class=\"btn small\" id=\"goldCodexPlusRun\" type=\"button\">Test read-only observer</button>\n        <button class=\"btn small\" id=\"goldCodexPlusCancel\" type=\"button\">Cancel sign-in</button>\n        <button class=\"btn small\" id=\"goldCodexPlusLogout\" type=\"button\">Sign out</button>\n      </div>\n      <div id=\"goldCodexPlusStatus\" class=\"muted\" role=\"status\">ChatGPT login not checked.</div>\n      <div id=\"goldCodexPlusDevice\" hidden style=\"border:1px solid #354653;border-radius:7px;padding:9px;margin:8px 0\">\n        <div>Open the official authorization page on your own device:</div>\n        <a id=\"goldCodexPlusUrl\" href=\"#\" target=\"_blank\" rel=\"noopener noreferrer\">Open ChatGPT device authorization</a>\n        <div>One-time code: <strong id=\"goldCodexPlusCode\" style=\"user-select:all\"></strong></div>\n      </div>\n      <pre id=\"goldCodexPlusOutput\" style=\"white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto\"></pre>\n    </section>\n\n  </div>\n</details>":''}
<div id="ptyOverlay" class="pty-overlay" role="dialog" aria-modal="false" aria-label="PTY Viewer" aria-hidden="true"><div id="ptyPanel" class="pty-card"><div id="ptyDragHandle" class="pty-bar" aria-label="Drag PTY Viewer"><strong class="pty-heading">${materialIcon('terminal')}<span>PTY Viewer</span><span class="pty-readonly">· read only</span><span class="pty-grip">${materialIcon('dragIndicator')}</span></strong><div class="actions"><button id="ptyRefresh" class="btn small" type="button" title="Refresh terminals" aria-label="Refresh terminals">${materialIcon('refresh')}</button><button id="ptyMinimize" class="btn small" type="button" title="Minimize PTY Viewer" aria-label="Minimize PTY Viewer"><span class="pty-minimize-icon">${materialIcon('minimize')}</span><span class="pty-expand-icon">${materialIcon('maximize')}</span></button><button id="ptyClose" class="btn small" type="button" title="Close PTY Viewer" aria-label="Close PTY Viewer">${materialIcon('close')}</button></div></div><div class="pty-warning">Terminal output may contain secrets. Visible only after you select a terminal. Device Agent PTYs only; Operator-side PTYs are not included.</div><div id="ptyTitle" class="pty-title">Select a terminal to view its live output.</div><div class="pty-detail"><div id="ptyList" class="pty-list"></div><pre id="ptyOutput" class="pty-screen" aria-live="off">Output is hidden until a terminal is selected.</pre></div></div></div><button id="ptyOpen" class="btn pty-launcher" type="button" aria-controls="ptyOverlay" aria-expanded="false">${materialIcon('terminal')}<span>PTY</span></button><div class="term"><div class="head"><span>LIVE OPERATOR STREAM</span><span id="stats" class="muted">0 jobs</span></div><div id="jobs"></div></div><div class="note">This Wall is observer/control only. Closing the browser does not stop the service, cloud lease, Agent sessions, or durable jobs.</div>
<script>
const box=document.getElementById('jobs'),devicebox=document.getElementById('devicebox'),tabs=document.getElementById('tabs'),sessionbox=document.getElementById('sessionbox'),sessionActions=document.getElementById('sessionActions'),filter=document.getElementById('filter'),statusSel=document.getElementById('status'),conn=document.getElementById('conn'),stats=document.getElementById('stats'),acode=document.getElementById('acode'),aexp=document.getElementById('aexp'),toggleA=document.getElementById('toggleA'),copyA=document.getElementById('copyA'),connectCloud=document.getElementById('connectCloud'),disconnectCloud=document.getElementById('disconnectCloud'),linkDevice=document.getElementById('linkDevice'),deviceCodeWrap=document.getElementById('deviceCodeWrap'),deviceCode=document.getElementById('deviceCode'),deviceCodeExp=document.getElementById('deviceCodeExp'),copyDeviceCode=document.getElementById('copyDeviceCode'),enrollMsg=document.getElementById('enrollMsg'),fleetWall=document.getElementById('fleetWall');
const wallCsrf=${JSON.stringify(csrf)};

const jobs=new Map(),sessions=new Map(),seenEvents=new Set(),seenOrder=[],dirtyJobs=new Set(),pendingKeys=new Set();let paused=false,pending=[],selected='ALL',localState=null,remoteState=null,grantExpiryAt=0,renderTimer=null,pairingA='',pairingVisible=false,pairingExpiresAt=0,pairRefreshInFlight=false,deviceEnrollmentCode='',enrollmentPollTimer=null;
const ptyOverlay=document.getElementById('ptyOverlay'),ptyList=document.getElementById('ptyList'),ptyOutput=document.getElementById('ptyOutput'),ptyTitle=document.getElementById('ptyTitle');
let ptyActive=null,ptyCursor=0,ptyBusy=false,ptyTimer=null,ptyEscapeState=0;
// Render PTY bytes as readable text. Strip ANSI CSI sequences without executing them.
function ptyPlain(value){let cleaned='';for(const ch of String(value||'')){const n=ch.charCodeAt(0);if(ptyEscapeState===1){ptyEscapeState=ch==='['?2:0;continue;}if(ptyEscapeState===2){if(n>=64&&n<=126)ptyEscapeState=0;continue;}if(n===27){ptyEscapeState=1;continue;}if(n===13)continue;cleaned+=ch;}return cleaned;}
async function ptyRefreshList(){
  ptyList.textContent='Loading PTYs…';
  try{
    const response=await fetch('/api/pty/sessions',{cache:'no-store'}),data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'pty_list_unavailable');
    ptyList.textContent='';
    const rows=(data.terminals||[]).filter(t=>selected==='ALL'||t.sessionId===selected);
    if(!rows.length){ptyList.textContent='No Device Agent PTYs in this session. Operator-side PTYs are separate.';return;}
    for(const t of rows){
      const button=document.createElement('button');button.type='button';button.className='btn small';
      button.textContent=String(t.shell||'shell')+' · '+String(t.state||'unknown')+' · '+short(t.terminalId,14)+' · '+fmtBytes(t.outputBytes||0);
      button.title='View PTY '+String(t.terminalId);button.onclick=()=>ptySelect(t);ptyList.appendChild(button);
    }
  }catch(error){ptyList.textContent='PTY list unavailable: '+String(error.message||error);}
}
function ptySelect(t){
  ptyActive=t;ptyEscapeState=0;ptyCursor=Math.max(0,(Number(t.outputBytes)||0)-32768);
  ptyOutput.textContent='';ptyTitle.textContent='Reading '+String(t.shell||'terminal')+' · '+String(t.state||'unknown')+' · '+short(t.terminalId,18);
  void ptyPull();
}
async function ptyPull(){
  if(!ptyActive||ptyBusy||!ptyOverlay.classList.contains('show')||ptyOverlay.classList.contains('minimized')||document.hidden)return;
  ptyBusy=true;const activeId=ptyActive.terminalId;
  try{
    const response=await fetch('/api/pty/output?terminalId='+encodeURIComponent(activeId)+'&offset='+String(ptyCursor),{cache:'no-store'});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'pty_output_unavailable');
    if(!ptyActive||ptyActive.terminalId!==activeId)return;
    const item=data.terminal||{},out=item.output||{};
    if(out.truncatedBefore)ptyOutput.textContent+='[Earlier output expired from bounded terminal buffer]'+String.fromCharCode(10);
    if(out.text)ptyOutput.textContent+=ptyPlain(out.text);
    if(ptyOutput.textContent.length>131072)ptyOutput.textContent='[Older displayed text trimmed]'+String.fromCharCode(10)+ptyOutput.textContent.slice(-120000);
    ptyCursor=Number(out.nextOffset)||ptyCursor;
    ptyOutput.scrollTop=ptyOutput.scrollHeight;
    ptyTitle.textContent='PTY '+short(activeId,18)+' · '+String(item.state||'unknown')+' · '+fmtBytes(out.totalBytes||0)+' · read-only';
  }catch(error){ptyTitle.textContent='PTY read unavailable: '+String(error.message||error);}
  finally{ptyBusy=false;}
}
// Persist only the widget's geometry and minimized flag, never terminal content.
const ptyPanel=document.getElementById('ptyPanel'),ptyHandle=document.getElementById('ptyDragHandle'),ptyLauncher=document.getElementById('ptyOpen'),ptyMinBtn=document.getElementById('ptyMinimize');
const PTY_LAYOUT_KEY='lightremote.g2.pty.layout.v1';
let ptyGeometry=null,ptyDrag=null;
function ptyLoadGeometry(){
  try{const value=JSON.parse(localStorage.getItem(PTY_LAYOUT_KEY)||'null');
    if(value&&['left','top','width','height'].every(k=>Number.isFinite(Number(value[k])))){
      return {left:Number(value.left),top:Number(value.top),width:Number(value.width),height:Number(value.height),minimized:value.minimized===true};
    }
  }catch{}return null;
}
function ptySaveGeometry(){
  if(!ptyGeometry)return;
  try{localStorage.setItem(PTY_LAYOUT_KEY,JSON.stringify(ptyGeometry));}catch{}
}
function ptyConstrain(rect){
  const vw=Math.max(1,window.innerWidth),vh=Math.max(1,window.innerHeight);
  const width=Math.min(Math.max(1,vw-12),Math.max(300,Number(rect.width)||760));
  const height=Math.min(Math.max(1,vh-12),Math.max(175,Number(rect.height)||530));
  return {width,height,left:Math.min(Math.max(6,Number(rect.left)||0),Math.max(6,vw-width-6)),top:Math.min(Math.max(6,Number(rect.top)||0),Math.max(6,vh-height-6))};
}
function ptyApplyGeometry(){
  if(!ptyGeometry)return;
  const next=ptyConstrain(ptyGeometry);
  Object.assign(ptyGeometry,next);
  Object.assign(ptyPanel.style,{left:next.left+'px',top:next.top+'px',right:'auto',bottom:'auto',width:next.width+'px',height:next.height+'px'});
}
function ptyRememberGeometry(){
  if(!ptyOverlay.classList.contains('show')||!ptyGeometry)return;
  const rect=ptyPanel.getBoundingClientRect();
  ptyGeometry.left=rect.left;ptyGeometry.top=rect.top;
  if(!ptyOverlay.classList.contains('minimized')){ptyGeometry.width=rect.width;ptyGeometry.height=rect.height;}
  ptySaveGeometry();
}
function ptyStopPolling(){
  if(ptyTimer){clearInterval(ptyTimer);ptyTimer=null;}
  ptyActive=null;ptyCursor=0;ptyEscapeState=0;
  ptyOutput.textContent='Output hidden until a terminal is selected.';
}
function ptyStartPolling(){
  void ptyRefreshList();
  if(ptyTimer)clearInterval(ptyTimer);
  ptyTimer=setInterval(()=>{if(!document.hidden)void ptyPull();},1500);
}
function ptySetMinimized(isMinimized){
  if(!ptyOverlay.classList.contains('show'))return;
  if(isMinimized){ptyRememberGeometry();ptyStopPolling();}
  ptyOverlay.classList.toggle('minimized',isMinimized);
  if(ptyGeometry){ptyGeometry.minimized=isMinimized;ptySaveGeometry();}
  ptyMinBtn.setAttribute('aria-label',isMinimized?'Expand PTY Viewer':'Minimize PTY Viewer');
  ptyMinBtn.title=isMinimized?'Expand PTY Viewer':'Minimize PTY Viewer';
  if(!isMinimized){ptyApplyGeometry();ptyStartPolling();}
  // The collapsed panel occupies less space; keep it within the viewport.
  requestAnimationFrame(()=>ptyKeepVisible());
}
function ptyKeepVisible(){
  if(!ptyOverlay.classList.contains('show'))return;
  const rect=ptyPanel.getBoundingClientRect(),left=Math.min(Math.max(6,rect.left),Math.max(6,window.innerWidth-rect.width-6)),top=Math.min(Math.max(6,rect.top),Math.max(6,window.innerHeight-rect.height-6));
  ptyPanel.style.left=left+'px';ptyPanel.style.top=top+'px';
  if(ptyGeometry){ptyGeometry.left=left;ptyGeometry.top=top;ptySaveGeometry();}
}
function ptyClose(){
  ptyRememberGeometry();ptyStopPolling();
  ptyDrag=null;ptyOverlay.classList.remove('show','minimized');ptyOverlay.setAttribute('aria-hidden','true');
  ptyLauncher.hidden=false;ptyLauncher.setAttribute('aria-expanded','false');ptyLauncher.focus();
}
function ptyOpen(){
  ptyOverlay.classList.add('show');ptyOverlay.setAttribute('aria-hidden','false');
  ptyLauncher.hidden=true;ptyLauncher.setAttribute('aria-expanded','true');
  ptyGeometry=ptyLoadGeometry();
  if(!ptyGeometry){const w=Math.min(760,window.innerWidth-12),h=Math.min(530,window.innerHeight-12);ptyGeometry={width:w,height:h,left:window.innerWidth-w-22,top:window.innerHeight-h-22,minimized:false};}
  ptyApplyGeometry();
  const minimized=ptyGeometry.minimized===true;
  ptyOverlay.classList.toggle('minimized',minimized);
  ptyMinBtn.setAttribute('aria-label',minimized?'Expand PTY Viewer':'Minimize PTY Viewer');
  ptyMinBtn.title=minimized?'Expand PTY Viewer':'Minimize PTY Viewer';
  ptyTitle.textContent='Select a terminal to view its live output.';
  ptyOutput.textContent='Output hidden until a terminal is selected.';
  if(!minimized)ptyStartPolling();
  requestAnimationFrame(()=>ptyKeepVisible());
  document.getElementById('ptyClose').focus();
}
ptyHandle.addEventListener('pointerdown',event=>{
  if(!ptyOverlay.classList.contains('show')||event.button!==0||event.target.closest('button'))return;
  event.preventDefault();
  const rect=ptyPanel.getBoundingClientRect();
  ptyDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
  ptyHandle.setPointerCapture(event.pointerId);
});
ptyHandle.addEventListener('pointermove',event=>{
  if(!ptyDrag||ptyDrag.pointerId!==event.pointerId)return;
  const width=ptyPanel.getBoundingClientRect().width,height=ptyPanel.getBoundingClientRect().height;
  const left=Math.max(6,Math.min(window.innerWidth-width-6,ptyDrag.left+event.clientX-ptyDrag.x));
  const top=Math.max(6,Math.min(window.innerHeight-height-6,ptyDrag.top+event.clientY-ptyDrag.y));
  ptyPanel.style.left=left+'px';ptyPanel.style.top=top+'px';
});
function ptyFinishDrag(event){
  if(!ptyDrag||ptyDrag.pointerId!==event.pointerId)return;
  ptyDrag=null;ptyRememberGeometry();
}
ptyHandle.addEventListener('pointerup',ptyFinishDrag);
ptyHandle.addEventListener('pointercancel',ptyFinishDrag);
ptyHandle.addEventListener('lostpointercapture',ptyFinishDrag);
ptyPanel.addEventListener('pointerup',()=>{if(!ptyDrag)ptyRememberGeometry();});
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{
  if(ptyOverlay.classList.contains('show')&&!ptyOverlay.classList.contains('minimized')&&!ptyDrag)ptyRememberGeometry();
}).observe(ptyPanel);
window.addEventListener('resize',()=>{if(ptyOverlay.classList.contains('show')){if(!ptyOverlay.classList.contains('minimized'))ptyApplyGeometry();ptyKeepVisible();}});
ptyLauncher.onclick=ptyOpen;document.getElementById('ptyClose').onclick=ptyClose;
document.getElementById('ptyRefresh').onclick=ptyRefreshList;
ptyMinBtn.onclick=()=>ptySetMinimized(!ptyOverlay.classList.contains('minimized'));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ptyOverlay.classList.contains('show'))ptyClose();});
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}function short(v,n=18){v=String(v||'');return v.length>n?v.slice(0,n)+'…':v;}function fmtRemaining(ms){ms=Math.max(0,Number(ms)||0);const m=Math.floor(ms/60000),h=Math.floor(m/60);return h?(h+'h '+(m%60)+'m'):(m+'m');}
function notify(message,kind='ok'){const host=document.getElementById('toastHost');if(!host)return;const el=document.createElement('div');el.className='toast '+(['ok','error','info'].includes(kind)?kind:'info');el.textContent=String(message||'Done');host.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),180);},1800);}
async function copyText(value,label='Copied'){
  const text=String(value??'');
  if(window.isSecureContext&&navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
    try{await navigator.clipboard.writeText(text);notify(label,'ok');return true;}catch{}
  }
  let node=null;const active=document.activeElement;
  try{
    node=document.createElement('textarea');node.value=text;node.setAttribute('readonly','');node.setAttribute('aria-hidden','true');
    Object.assign(node.style,{position:'fixed',top:'0',left:'-9999px',width:'1px',height:'1px',opacity:'0',pointerEvents:'none',fontSize:'16px'});
    document.body.appendChild(node);
    try{node.focus({preventScroll:true});}catch{node.focus();}
    node.select();node.setSelectionRange(0,node.value.length);
    if(document.execCommand('copy')){notify(label,'ok');return true;}
  }catch{}
  finally{
    try{node?.remove();}catch{}
    try{if(active&&typeof active.focus==='function')active.focus({preventScroll:true});}catch{try{active?.focus?.();}catch{}}
  }
  notify('Copy failed','error');return false;
}
function confirmAction(message){return new Promise(resolve=>{const overlay=document.getElementById('confirmOverlay'),text=document.getElementById('confirmText'),ok=document.getElementById('confirmOk'),cancel=document.getElementById('confirmCancel');if(!overlay){resolve(false);return;}text.textContent=String(message||'Confirm action?');overlay.classList.add('show');overlay.setAttribute('aria-hidden','false');const done=v=>{overlay.classList.remove('show');overlay.setAttribute('aria-hidden','true');ok.onclick=null;cancel.onclick=null;resolve(v);};ok.onclick=()=>done(true);cancel.onclick=()=>done(false);overlay.onclick=e=>{if(e.target===overlay)done(false);};cancel.focus();});}
function displayBadgeLabel(j){return toolLabel(j)||fallbackCommandBadge(j);}function fallbackCommandBadge(j){const text=String(commandText(j)||'').trim();if(!text)return 'COMMAND';if(/\$env:|\b(?:Write-Output|Get-|Set-|New-|Remove-|Start-|Stop-|Invoke-)/i.test(text))return 'POWERSHELL';const m=text.match(/^\s*(?:sudo\s+|env\s+|nohup\s+|time\s+)?([^\s;&|]+)/),raw=String(m?.[1]||'').replace(/^.*[\\/]/,'').toLowerCase(),map={git:'GIT',powershell:'POWERSHELL','powershell.exe':'POWERSHELL',pwsh:'POWERSHELL','pwsh.exe':'POWERSHELL',cmd:'CMD','cmd.exe':'CMD',npm:'PACKAGE',pnpm:'PACKAGE',yarn:'PACKAGE',bun:'PACKAGE',pip:'PACKAGE',pip3:'PACKAGE',docker:'CONTAINER',podman:'CONTAINER',kubectl:'K8S',helm:'K8S',k3s:'K8S',ssh:'SSH',journalctl:'JOURNAL',systemctl:'SYSTEMCTL'};return map[raw]||'COMMAND';}
function refreshAbGrantTimer(){
  const el=document.getElementById('abGrantTimer');el.className='muted';
  if(!grantExpiryAt){el.textContent=remoteState?.ok===false?'Agent A/B access · status temporarily unavailable':'Agent A/B access · no active approval';return;}
  const sec=Math.max(0,Math.ceil((grantExpiryAt-Date.now())/1000));
  if(!sec){el.className='error';el.textContent='Agent A/B access expired · new approval required';return;}
  const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
  el.textContent='Agent A/B access · '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+' remaining (24-hour limit)';
}
function renderPairing(){acode.textContent=pairingA?(pairingVisible?pairingA:'••••-••••'):'—';toggleA.disabled=!pairingA;copyA.disabled=!pairingA;toggleA.classList.toggle('revealed',pairingVisible);toggleA.title=pairingVisible?'Hide A':'Show A';toggleA.setAttribute('aria-label',toggleA.title);tickPairingCountdown();}function tickPairingCountdown(){if(!pairingA||!pairingExpiresAt){aexp.textContent='--:--';return;}const left=Math.max(0,pairingExpiresAt-Date.now()),total=Math.ceil(left/1000),m=Math.floor(total/60),sec=total%60;aexp.textContent=String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');if(left<=0&&!pairRefreshInFlight)refreshPairing(false);}
const LEGACY_BINARY_MARKER='[binary output suppressed · legacy event]'+String.fromCharCode(10);function safeOutputChunk(value){const s=String(value??'');if(!s)return '';let replacements=0,controls=0;for(const ch of s){const code=ch.charCodeAt(0);if(ch==='�')replacements++;else if(code<32&&code!==9&&code!==10&&code!==13)controls++;}if(replacements>=4||(replacements>=2&&replacements*50>s.length)||controls>=4)return LEGACY_BINARY_MARKER;return s;}function eventKey(e){return e&&e.id!=null&&e.at?String(e.id)+'@'+String(e.at):'';}function eventSeen(e){const k=eventKey(e);return !!k&&seenEvents.has(k);}function rememberEvent(e){const k=eventKey(e);if(!k||seenEvents.has(k))return;seenEvents.add(k);seenOrder.push(k);while(seenOrder.length>12000)seenEvents.delete(seenOrder.shift());}
function fmtBytes(n){n=Math.max(0,Number(n)||0);if(n<1024)return n+' B';if(n<1024*1024)return (n/1024).toFixed(n<10*1024?1:0)+' KB';return (n/1024/1024).toFixed(n<10*1024*1024?1:0)+' MB';}function fsCommand(j){const m=j.toolMeta||{};if(m.kind!=='fs')return '';const op=String(m.op||'unknown'),head='fs.'+op;if(op==='readMany'){const paths=Array.isArray(m.paths)?m.paths:[],count=Number(m.pathCount||paths.length);return head+' '+count+' path'+(count===1?'':'s')+(paths[0]?' · '+String(paths[0]):'')+(count>1?' · +'+(count-1):'');}if(op==='copy'||op==='move')return head+' '+String(m.source||'')+' -> '+String(m.destination||'')+(m.overwrite?' · overwrite':'');const p=String(m.path||'');let extra='';if(op==='write')extra=' · '+fmtBytes(m.bytes)+' · '+String(m.mode||'rewrite');else if(op==='edit')extra=' · '+fmtBytes(m.oldBytes)+' -> '+fmtBytes(m.newBytes)+(m.expectedReplacements!=null?' · expect '+m.expectedReplacements:'');else if(op==='read'){if(m.startLine!=null)extra+=' · line '+m.startLine;if(m.maxLines!=null)extra+=' · max '+m.maxLines+' lines';if(m.tailLines!=null)extra+=' · tail '+m.tailLines;}else if(op==='list'&&m.maxDepth!=null)extra=' · depth '+m.maxDepth;else if(op==='mkdir'&&m.parents)extra=' · parents';else if(op==='delete'&&m.recursive)extra=' · recursive';return head+(p?' '+p:'')+extra;}const LEGACY_TOOL_PREFIXES=[['native-fs:','fs'],['native-search:','search'],['native-process:','process'],['native-terminal:','terminal'],['native-desktop:','desktop'],['light-scp:','scp']];function toolIdentity(j){const m=j.toolMeta||{};let kind=String(m.kind||'').toLowerCase(),op=String(m.op||'').toLowerCase();if(!kind){for(const raw of [String(j.note||''),String(j.script||'')]){for(const [prefix,name] of LEGACY_TOOL_PREFIXES){if(raw.startsWith(prefix)){kind=name;op=raw.slice(prefix.length).toLowerCase();break;}}if(kind)break;}}return{m,kind,op:op||'unknown'};}function syntheticToolScript(j){const script=String(j.script||'');return LEGACY_TOOL_PREFIXES.some(([prefix])=>script.startsWith(prefix));}function nativeHandle(v){v=String(v||'');return v.length>18?v.slice(0,18)+'…':v;}function toolCommand(j){const i=toolIdentity(j),m=i.m,op=i.op;if(i.kind==='fs')return fsCommand(j)||('fs.'+op+(j.cwd?' '+j.cwd:''));if(i.kind==='terminal')return String(m.label||('pty.'+op));if(i.kind==='search'){const q=m.pattern?JSON.stringify(String(m.pattern)):'',loc=String(m.path||j.cwd||''),file=String(m.filePattern||'');if(op==='start')return ['search.start',String(m.searchType||'content'),q,file,loc].filter(Boolean).join(' · ');if(op==='results')return ['search.results',q,file,loc,!q&&!loc?nativeHandle(m.searchId):'',Number(m.offset)>0?'offset '+m.offset:''].filter(Boolean).join(' · ');if(op==='cancel')return ['search.cancel',q,file,loc,!q&&!loc?nativeHandle(m.searchId):''].filter(Boolean).join(' · ');return 'search.'+op;}if(i.kind==='process'){if(op==='input')return 'process.input '+nativeHandle(m.processId)+' · '+String(m.inputBytes||0)+' B'+(m.eof?' · EOF':'');if(op==='output')return 'process.output '+nativeHandle(m.processId)+' · '+String(m.stream||'stdout')+' · offset '+String(m.offset||0)+' · limit '+String(m.limit||262144)+' B';if(op==='stop')return 'process.stop '+nativeHandle(m.processId)+(m.force?' · force':'');if(op==='list')return 'process.list';return 'process.'+op+(j.cwd?' '+j.cwd:'');}if(i.kind==='scp'){const id=nativeHandle(m.transferId);if(op==='upload-begin')return ['scp.upload',String(m.destination||''),m.totalBytes!=null?fmtBytes(m.totalBytes):'',m.overwrite?'overwrite':''].filter(Boolean).join(' · ');if(op==='download-begin')return ['scp.download',String(m.source||''),m.totalBytes!=null?fmtBytes(m.totalBytes):''].filter(Boolean).join(' · ');if(op==='upload-chunk'||op==='download-chunk')return ['scp.'+op,id,m.index!=null?'chunk '+m.index:'',m.offset!=null?'offset '+m.offset:'',m.bytes!=null?fmtBytes(m.bytes):''].filter(Boolean).join(' · ');if(op==='status'||op==='cancel'||op==='upload-commit')return 'scp.'+op+' '+id;return 'scp.'+op;}if(i.kind==='desktop')return String(m.label||('desktop.'+op));return i.kind?(i.kind+'.'+op):'';}function commandText(j){const formatted=toolCommand(j),script=String(j.script||'');if(formatted&&(!script||syntheticToolScript(j)))return String(formatted);return String(script||formatted||j.note||j.jobId||'');}function toolLabel(j){const i=toolIdentity(j),names={terminal:'PTY',fs:'FS',search:'SEARCH',process:'PROCESS',scp:'SCP',desktop:'DESKTOP'},name=names[i.kind]||String(i.kind||'').toUpperCase();return name?(name+' '+String(i.op||'').toUpperCase()):'';}function groupBadgeClass(j){const k=toolIdentity(j).kind;return k==='fs'?'op-fs':k==='search'?'op-search':['process','terminal','scp','desktop'].includes(k)?'op-runtime':'';}function riskBadge(j){const i=toolIdentity(j),m=i.m||{},op=i.op,caps=(Array.isArray(j.requiredCapabilities)?j.requiredCapabilities:[]).map(v=>String(v).toLowerCase()),text=(String(j.script||'')+' '+String(j.note||'')+' '+commandText(j)).toLowerCase();let danger=caps.includes('sudo-on-demand')||caps.includes('systemctl')||['sudo ','systemctl ','shutdown','reboot','poweroff','mkfs','rm -rf','rm -fr','git reset --hard','git push --force','git push -f','maintenance','signed client update'].some(v=>text.includes(v));if(i.kind==='fs'&&(op==='delete'||m.overwrite===true))danger=true;if(i.kind==='process'&&op==='stop'&&m.force===true)danger=true;if(danger)return{label:'DANGER',cls:'risk-red'};let mutate=caps.some(c=>['docker','lxd','build-test'].includes(c))||['git add ','git commit ','git push ','git checkout ','git switch ','git merge ','git rebase ','git cherry-pick ','git tag ','mv ','cp ','mkdir ','touch ','chmod ','chown ','install ','tee ','sed -i'].some(v=>text.includes(v));if(i.kind==='fs'&&['write','edit','mkdir','copy','move'].includes(op))mutate=true;if(i.kind==='process'&&['start','input','stop'].includes(op))mutate=true;if(i.kind==='terminal'&&['start','input','resize','signal','stop'].includes(op))mutate=true;if(i.kind==='scp'&&(op.startsWith('upload')||op==='cancel'))mutate=true;if(i.kind==='desktop'&&op==='input')mutate=true;if(!mutate)return null;const system=caps.some(c=>['docker','lxd','build-test'].includes(c));return{label:system?'SYSTEM':'MUTATE',cls:'risk-yellow'};}function shellEsc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}const SHELL_KEYWORDS=new Set(['if','then','elif','else','fi','for','foreach','in','do','done','while','until','case','esac','function','select','switch','trap','return','break','continue','export','readonly','local','declare','typeset','set','unset']);const SHELL_WRAPPERS=new Set(['sudo','env','command','builtin','exec','nohup','time','xargs']);const SHELL_DANGER=new Set(['sudo','systemctl','shutdown','reboot','poweroff','mkfs','rm']);function shellSyntaxHtml(value){const text=String(value??''),bs=String.fromCharCode(92),tab=String.fromCharCode(9),lf=String.fromCharCode(10),cr=String.fromCharCode(13),bt=String.fromCharCode(96);let out='',i=0,expectCommand=true;const emit=(cls,t)=>{out+=cls?'<span class="'+cls+'">'+shellEsc(t)+'</span>':shellEsc(t);};const space=c=>c===' '||c===tab||c===lf||c===cr;const opchar=c=>c==='|'||c==='&'||c===';'||c==='>'||c==='<';const digitWord=t=>{if(!t)return false;for(const c of t)if(c<'0'||c>'9')return false;return true;};const pathWord=t=>t.startsWith('./')||t.startsWith('../')||t.startsWith('/')||t.startsWith('~/')||t.includes(bs)||(t.length>2&&t[1]===':'&&(t[2]===bs||t[2]==='/'));while(i<text.length){const c=text[i];if(space(c)){let j=i+1;while(j<text.length&&space(text[j]))j++;const t=text.slice(i,j);emit('',t);if(t.includes(lf)||t.includes(cr))expectCommand=true;i=j;continue;}if(c==='#'&&(i===0||space(text[i-1]))){let j=i+1;while(j<text.length&&text[j]!==lf&&text[j]!==cr)j++;emit('syn-comment',text.slice(i,j));i=j;continue;}if(c==="'"||c==='"'||c===bt){const q=c;let j=i+1;while(j<text.length){if(text[j]===q){j++;break;}if(text.charCodeAt(j)===92&&j+1<text.length)j+=2;else j++;}emit('syn-string',text.slice(i,j));expectCommand=false;i=j;continue;}if(c==='$'){let j=i+1;while(j<text.length&&!space(text[j])&&!opchar(text[j])&&text[j]!=="'"&&text[j]!=='"'&&text[j]!==bt)j++;emit('syn-var',text.slice(i,j));expectCommand=false;i=j;continue;}if(c==='%'){const end=text.indexOf('%',i+1);if(end>i+1){emit('syn-var',text.slice(i,end+1));expectCommand=false;i=end+1;continue;}}if(opchar(c)){let j=i+1;while(j<text.length&&opchar(text[j]))j++;const t=text.slice(i,j);emit('syn-op',t);if(t.includes('|')||t.includes('&')||t.includes(';'))expectCommand=true;i=j;continue;}let j=i+1;while(j<text.length&&!space(text[j])&&!opchar(text[j])&&text[j]!=="'"&&text[j]!=='"'&&text[j]!==bt)j++;const t=text.slice(i,j),low=t.toLowerCase();let cls='';if(t.startsWith('-'))cls='syn-option';else if(t.includes('=')&&!pathWord(t))cls='syn-var';else if(pathWord(t))cls='syn-path';else if(SHELL_KEYWORDS.has(low)){cls='syn-keyword';expectCommand=['if','then','elif','else','for','foreach','while','until','do','case','function','select','switch'].includes(low);}else if(expectCommand){cls=SHELL_DANGER.has(low)?'syn-danger-command':'syn-command';expectCommand=SHELL_WRAPPERS.has(low);}else if(digitWord(t))cls='syn-number';emit(cls,t);i=j;}return out;}function terminalHandle(j){const id=String(j.toolMeta?.terminalId||'');return id?(id.length>18?id.slice(0,18)+'…':id):'';}function jobText(j){return ['['+(j.status||'running')+'] '+j.jobId,toolLabel(j)?'operation: '+toolLabel(j):'',terminalHandle(j)?'terminal: '+terminalHandle(j):'','session: '+(j.sessionId||''),'agent: '+(j.agentId||''),'cwd: '+(j.cwd||''),'command:\\n'+commandText(j),j.resultSummary?'result: '+j.resultSummary:'',j.stdout?'stdout:\\n'+j.stdout:'',j.stderr?'stderr:\\n'+j.stderr:'',j.exitCode!=null?'exit: '+j.exitCode:'',j.durationMs!=null?'duration_ms: '+j.durationMs:''].filter(Boolean).join('\\n');}
function liveSessions(){return [...sessions.values()].filter(s=>s.state==='active'||s.state==='hold').sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));}function lastSeenLabel(s){const at=Number(s?.lastSeenAt)||0;if(!at)return 'unknown';const sec=Math.max(0,Math.floor((Date.now()-at)/1000));if(sec<60)return sec+'s ago';const min=Math.floor(sec/60);if(min<60)return min+'m ago';const h=Math.floor(min/60);return h+'h '+(min%60)+'m ago';}function closableHeldSessions(){return liveSessions().filter(s=>s.state==='hold'&&!(s.activeJobs?.length));}async function closeOneSession(s){if(!s)return;if(Number(s.activeJobs?.length||0)>0){notify('Session still has active jobs','error');return;}if(!await confirmAction('Close session '+(s.label||short(s.sessionId,14))+'? This ends only this Agent lane and does not disconnect the device.'))return;try{const result=await wallMutation('/api/session-close',{sessionId:s.sessionId,agentId:s.agentId});if(result.session?.state!=='closed')throw Error('session_close_unconfirmed');statusEpoch++;sessions.delete(s.sessionId);selected='ALL';renderHeader();renderTabs();applyFilter();await refreshStatus();notify('Session closed','ok');}catch(e){notify(e.message,'error');}}async function closeHeldSessions(){const rows=closableHeldSessions();if(!rows.length){notify('No held sessions to close','info');return;}if(!await confirmAction('Close '+rows.length+' held session'+(rows.length===1?'':'s')+' with no active jobs?'))return;const failed=[];for(const s of rows){try{const result=await wallMutation('/api/session-close',{sessionId:s.sessionId,agentId:s.agentId});if(result.session?.state!=='closed')throw Error('session_close_unconfirmed');statusEpoch++;sessions.delete(s.sessionId);}catch(e){failed.push((s.label||short(s.sessionId,14))+': '+e.message);}}selected='ALL';renderHeader();renderTabs();applyFilter();await refreshStatus();if(failed.length)notify('Close failed: '+failed.join('; ').slice(0,190),'error');else notify(rows.length+' held session'+(rows.length===1?'':'s')+' closed','ok');}function renderSessionActions(){sessionActions.innerHTML='';if(selected==='ALL'){const held=closableHeldSessions(),note=document.createElement('span');note.className='muted';note.textContent='Manual cleanup only · nothing is auto-closed';sessionActions.appendChild(note);for(const s of held){const b=document.createElement('button');b.className='btn small danger';b.type='button';b.textContent='Close '+(s.label||short(s.sessionId,14))+' · '+lastSeenLabel(s);b.onclick=()=>closeOneSession(s);sessionActions.appendChild(b);}const all=document.createElement('button');all.className='btn small danger';all.type='button';all.textContent='Close held sessions · '+held.length;all.disabled=!held.length;all.onclick=closeHeldSessions;sessionActions.appendChild(all);return;}const s=sessions.get(selected);if(!s)return;const info=document.createElement('span');info.className='muted';info.textContent='last seen '+lastSeenLabel(s)+' · active jobs '+String(s.activeJobs?.length||0)+' · manual cleanup only';sessionActions.appendChild(info);const b=document.createElement('button');b.className='btn small danger';b.type='button';b.textContent='Close session';b.disabled=Number(s.activeJobs?.length||0)>0;b.title=b.disabled?'Active job must finish or be stopped first':'Close this Agent lane';b.onclick=()=>closeOneSession(s);sessionActions.appendChild(b);}

function renderEnrollmentControl(){const s=localState||{},revoked=String(s.lastCloudError||'')==='device_revoked',needsLink=!s.enrolled||revoked,pendingEnroll=Boolean(s.pendingEnrollmentId);linkDevice.style.display=needsLink?'':'none';linkDevice.querySelector('.label').textContent=revoked?'Re-enroll device':(pendingEnroll?'New link code':'Link device');connectCloud.disabled=needsLink||pendingEnroll;if(!needsLink){deviceEnrollmentCode='';deviceCodeWrap.style.display='none';copyDeviceCode.style.display='none';copyDeviceCode.disabled=true;deviceCode.textContent='—';deviceCodeExp.textContent='';}}
function renderHeader(){const s=localState||{},r=remoteState||{},d=r.device||{},c=r.connection||{},localConnected=s.cloudDesiredConnected&&s.cloudState==='connected',rateLimited=r.ok===false&&(Number(r.status)===429||String(r.error||'')==='rate_limited'),connected=localConnected&&(c.state==='connected'||rateLimited);const plan=(c.plan||s.connectionPlan||'').toUpperCase(),lease=connected&&c.remainingMs!=null?' · '+plan+' · '+fmtRemaining(c.remainingMs)+' remaining':'',limitNote=rateLimited?' · '+(r.stale?'status cached (rate limited)':'status rate limited')+(r.retryAfterSeconds?' · retry '+String(r.retryAfterSeconds)+'s':''):'',revoked=String(s.lastCloudError||'')==='device_revoked',stateLabel=revoked?'revoked':(d.state||(!s.enrolled?'not enrolled':'local'));devicebox.innerHTML='<b>'+esc(d.displayName||s.deviceName||s.deviceId||'device')+'</b> · <span class="'+(stateLabel==='online'?'ok':revoked?'error':'muted')+'">'+esc(stateLabel)+'</span> · <span class="'+(rateLimited?'running':connected?'ok':'hold')+'">cloud '+esc(connected?'connected':'dormant')+esc(limitNote)+'</span>'+lease+' · '+esc(d.platform||s.platformAdapter||'unknown')+'/'+esc(d.architecture||'')+' · sessions '+esc(liveSessions().length)+' · agent '+esc(d.agentVersion||s.version||'unknown')+'<br><a href="/permissions" class="muted" title="View permissions and effective capabilities">Profile: '+esc(s.localPolicyProfile||'custom')+' · Manage permissions</a>';const comp=d.compatibility||{},u=s.update||{},updateNote=comp.updateRequired?'<br><span class="error">Server requires client update · Core '+esc(comp.clientVersion||d.agentVersion||s.version||'unknown')+' · minimum '+esc(comp.minimumSupportedVersion||'supported version')+(comp.latestVersion?' · latest '+esc(comp.latestVersion):'')+'</span> · <a href="/settings">Update now</a>':comp.status==='server_update_required'?'<br><span class="hold">Server update required · client '+esc(comp.clientVersion||d.agentVersion||s.version||'unknown')+' · server '+esc(comp.latestVersion||'unknown')+'</span>':String(u.state||'')==='available'?'<br><span class="hold">Update available → '+esc(u.targetVersion||'new version')+'</span> · <a href="/settings">Open Settings</a>':'';devicebox.innerHTML+=updateNote;const fw=s.fleetWall||{};fleetWall.style.display=fw.healthy?'':'none';if(fw.healthy)fleetWall.href=fw.publicUrl||('http://'+location.hostname+':'+String(fw.port||5492)+'/');const ep=s.executorProbe||{},er=s.executorReady===true?'ready':s.executorReady===false?'unavailable':'unknown',ec=er==='ready'?'ok':er==='unavailable'?'error':'muted';
devicebox.innerHTML+='<br><span class="'+ec+'">Executor '+esc(er)+'</span> · <span class="muted">spawn probe '+esc(ep.state||'unknown')+' · checks '+esc(ep.checks??0)+' · failures '+esc(ep.consecutiveFailures??0)+'</span>';
renderEnrollmentControl();}
function renderTabs(){const live=liveSessions();if(selected!=='ALL'&&!live.some(s=>s.sessionId===selected))selected='ALL';tabs.innerHTML='';const all=document.createElement('button');all.className='tab '+(selected==='ALL'?'active':'');all.textContent='ALL · '+live.length;all.onclick=()=>{selected='ALL';renderTabs();applyFilter();};tabs.appendChild(all);for(const s of live){const b=document.createElement('button');b.className='tab '+(selected===s.sessionId?'active':'');b.innerHTML=esc(s.label||short(s.sessionId,14))+' <span class="state '+esc(s.state)+'">'+esc(s.state)+'</span>';b.onclick=()=>{selected=s.sessionId;renderTabs();applyFilter();};tabs.appendChild(b);}renderSessionBox();renderSessionActions();}
function renderSessionBox(){if(selected==='ALL'){sessionbox.textContent='device '+(localState?.deviceName||localState?.deviceId||'')+' · live sessions '+liveSessions().length+' · Wall can be closed without affecting runtime';return;}const s=sessions.get(selected);if(!s){sessionbox.textContent='session unavailable';return;}const graceMin=(s.graceMs||s.leaseMs)?Math.round((s.graceMs||s.leaseMs)/60000):0;sessionbox.innerHTML='<b>'+esc(s.label||s.sessionId)+'</b> · '+esc(s.state)+(s.holdReason?' · '+esc(s.holdReason):'')+'<br>session '+esc(s.sessionId)+' · agent '+esc(short(s.agentId,24))+'<br>reconnect grace '+esc(graceMin?graceMin+'m':'default')+' · calls '+esc(s.stats?.toolCalls||0)+' · exec '+esc(s.stats?.execCalls||0)+' · active jobs '+esc(s.activeJobs?.length||0)+' · reconnects '+esc(s.reconnectCount||0);}
function scpInlineProgress(j){
 const identity=toolIdentity(j);
 if(identity.kind!=='scp')return '';
 const op=identity.op,summary=String(j.resultSummary||'').slice(0,512);
 if(j.status==='error'||j.status==='timeout')return '';
 // Progress is derived from the exact job_finished result, never from a
 // later snapshot (which would incorrectly relabel historical chunk rows).
 let received=null,total=null,chunks=null,totalChunks=null,stage='';
 const match=summary.match(/(?:^|[·\\s])([0-9]{1,16})\\/([0-9]{1,16}) B(?:\\s|$|·)/);
 if(match){received=Number(match[1]);total=Number(match[2]);}
 const count=summary.match(/(?:^|[·\\s])([0-9]{1,12})\\/([0-9]{1,12}) chunks(?:\\s|$|·)/);
 if(count){chunks=Number(count[1]);totalChunks=Number(count[2]);}
 const commit=op==='upload-commit'&&j.status==='ok';
 if(commit){stage='SHA-256 verified';}
 else if(op==='cancel'&&j.status==='ok'){stage='cancelled';}
 else if(op==='upload-chunk'||op==='upload-begin'||(op==='status'&&!summary.trim().startsWith('download'))){
   if(total!==null&&received===total)stage='awaiting commit';
 }else if(op==='download-chunk'||op==='download-begin'||(op==='status'&&summary.trim().startsWith('download'))){
   if(total!==null&&received===total)stage='served · receiver unconfirmed';
 }
 if(commit&&total===null){received=1;total=1;}
 if(!Number.isSafeInteger(received)||!Number.isSafeInteger(total)||total<=0||received<0||received>total)return '';
 if(chunks!==null&&(!Number.isSafeInteger(chunks)||!Number.isSafeInteger(totalChunks)||chunks<0||chunks>totalChunks||totalChunks<1))return '';
 const percent=Math.min(100,Math.floor(received*100/total));
 const filled=Math.min(16,Math.floor(percent*16/100));
 const bar='['+'#'.repeat(filled)+'-'.repeat(16-filled)+']';
 const details=commit?'':(' · '+fmtBytes(received)+' / '+fmtBytes(total));
 const countLabel=chunks!==null?' · '+chunks+'/'+totalChunks+' chunks':'';
 return '<span class="scp-inline-progress" aria-label="SCP '+percent+' percent">'+esc(bar)+' <strong>'+percent+'%</strong>'+esc(details+countLabel+(stage?' · '+stage:''))+'</span>';
}
function applyFilter(){const q=filter.value.toLowerCase(),st=statusSel.value;let visible=0;for(const [id,j] of jobs){const el=document.getElementById('j-'+id);if(!el)continue;const lane=selected==='ALL'||j.sessionId===selected,hay=q?[j.cwd,commandText(j),j.script,j.stdout,j.stderr,j.note,j.resultSummary,JSON.stringify(j.toolMeta||{}),displayBadgeLabel(j),terminalHandle(j),id,j.sessionId,j.agentId].join(' ').toLowerCase():'';const hide=!lane||(q&&!hay.includes(q))||(st&&j.status!==st);el.classList.toggle('hidden',!!hide);if(!hide)visible++;}stats.textContent=visible+' visible / '+jobs.size+' jobs';}
function renderJob(j){let el=document.getElementById('j-'+j.jobId);if(!el){el=document.createElement('div');el.className='job';el.id='j-'+j.jobId;box.prepend(el);while(box.children.length>2500)box.lastChild.remove();}const nativeOp=toolLabel(j),op=nativeOp||fallbackCommandBadge(j),handle=terminalHandle(j),inlineProgress=scpInlineProgress(j),summary=j.resultSummary&&!inlineProgress?'<span class="resultline">'+esc(j.resultSummary)+'</span>':'',badge=op?'<span class="opbadge '+esc(nativeOp?groupBadgeClass(j):'op-neutral')+'">'+esc(op)+'</span>':'',risk=riskBadge(j),riskHtml=risk?'<span class=\"riskbadge '+esc(risk.cls)+'\">'+esc(risk.label)+'</span>':'',metaTerminal=handle?' · terminal '+esc(handle):'';el.innerHTML='<div class="commandrow"><span class="'+esc(j.status||'running')+'">'+esc(j.status||'running')+'</span><span class="muted">'+esc(new Date(j.at||j.startedAt||Date.now()).toLocaleTimeString())+'</span><div class="cmdwrap">'+badge+riskHtml+'<span><code class="cmdtext">'+shellSyntaxHtml(commandText(j))+'</code>'+inlineProgress+summary+'</span></div><span class="actions"><button class="btn small" data-copy="cmd">${materialIcon('copy')}<span>Copy cmd</span></button><button class="btn small" data-copy="out">${materialIcon('copy')}<span>Copy output</span></button><button class="btn small" data-copy="raw">${materialIcon('copy')}<span>Copy raw</span></button></span></div><div class="meta">session '+esc(j.sessionId||'')+' · agent '+esc(short(j.agentId,24))+metaTerminal+(j.cwd?' · '+esc(j.cwd):'')+'</div>'+(j.stdout?'<pre>'+esc(j.stdout)+'</pre>':'')+(j.stderr?'<pre class="stderr">'+esc(j.stderr)+'</pre>':'');el.querySelector('[data-copy="cmd"]').onclick=()=>copyText(commandText(j),'Command copied');el.querySelector('[data-copy="out"]').onclick=()=>copyText((j.stdout||'')+(j.stderr?'\\n[stderr]\\n'+j.stderr:''),'Output copied');el.querySelector('[data-copy="raw"]').onclick=()=>copyText(jobText(j),'Raw job copied');}
function flushRenders(){renderTimer=null;const ids=[...dirtyJobs];dirtyJobs.clear();for(const id of ids){const j=jobs.get(id);if(j)renderJob(j);}applyFilter();}function scheduleRender(id){if(id)dirtyJobs.add(id);if(!renderTimer)renderTimer=setTimeout(flushRenders,50);}
function ingest(e,queue=true){if(!e||eventSeen(e))return;if(paused&&queue){const k=eventKey(e);if(!k||!pendingKeys.has(k)){pending.push(e);if(k)pendingKeys.add(k);}return;}let j=e.jobId?jobs.get(e.jobId):null;if(e.type==='job_started'){if(!j){j={jobId:e.jobId,requestId:e.requestId,sessionId:e.sessionId,agentId:e.agentId,status:'running',cwd:e.cwd,script:e.script,note:e.note,toolMeta:e.toolMeta||null,requiredCapabilities:e.requiredCapabilities||[],resultSummary:e.resultSummary||'',stdout:'',stderr:'',at:e.at};jobs.set(e.jobId,j);}else Object.assign(j,e);}else if(e.type==='stdout'||e.type==='stderr'){if(!j)return;const chunk=safeOutputChunk(e.chunk);if(chunk&&!(chunk===LEGACY_BINARY_MARKER&&j[e.type].endsWith(LEGACY_BINARY_MARKER)))j[e.type]+=chunk;}else if(e.type==='job_finished'){if(!j){j={jobId:e.jobId,requestId:e.requestId,sessionId:e.sessionId,agentId:e.agentId,status:e.status||'ok',cwd:e.cwd||'',script:e.script||'',note:e.note||'',toolMeta:e.toolMeta||null,requiredCapabilities:e.requiredCapabilities||[],resultSummary:e.resultSummary||'',stdout:'',stderr:'',at:e.at};jobs.set(e.jobId,j);}Object.assign(j,{status:e.status,exitCode:e.exitCode,durationMs:e.durationMs,cwd:e.cwd??j.cwd,script:e.script??j.script,note:e.note??j.note,requiredCapabilities:e.requiredCapabilities||j.requiredCapabilities||[],resultSummary:e.resultSummary||j.resultSummary||'',toolMeta:e.toolMeta||j.toolMeta||null});}else if(e.type?.startsWith('session_')||e.type?.startsWith('device_')||e.type?.startsWith('device_access_'))refreshStatus();rememberEvent(e);if(j)scheduleRender(j.jobId);}
let statusEpoch=0;async function refreshStatus(){const epoch=statusEpoch;try{const r=await fetch('/api/status',{cache:'no-store'}),d=await r.json();if(epoch!==statusEpoch)return;localState=d.local||null;remoteState=d.remote||null;
  const grant=remoteState?.access?.activeGrant||null;
  const expiry=Number(grant?.absoluteExpiresAt)||0,rolling=Number(grant?.expiresAt)||0;
  grantExpiryAt=expiry&&rolling?Math.min(expiry,rolling):expiry||rolling;
  refreshAbGrantTimer();sessions.clear();for(const s of (remoteState?.sessions||[]))sessions.set(s.sessionId,s);renderHeader();renderTabs();applyFilter();}catch{devicebox.textContent='device metadata unavailable';}}
async function refreshPairing(forceRotate=false){if(pairRefreshInFlight)return;pairRefreshInFlight=true;try{const j=await wallMutation('/api/pairing-code',{rotate:forceRotate});pairingA=String(j.pairing.code||'');pairingExpiresAt=Number(j.pairing.expiresAt)||0;pairingVisible=false;renderPairing();}catch(e){pairingA='';pairingExpiresAt=0;pairingVisible=false;renderPairing();aexp.textContent=(String(e.message).includes('connection')?'connect first':'unavailable');}finally{pairRefreshInFlight=false;}}
async function wallMutation(path,payload={}){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':wallCsrf},body:JSON.stringify(payload)}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'wall_action_failed');return j;}
function stopEnrollmentPoll(){if(enrollmentPollTimer){clearInterval(enrollmentPollTimer);enrollmentPollTimer=null;}}
async function pollDeviceEnrollment(){try{const j=await wallMutation('/api/enrollment/poll');const state=String(j.enrollment?.state||'');if(state==='approved'){stopEnrollmentPoll();deviceEnrollmentCode='';deviceCodeWrap.style.display='none';copyDeviceCode.style.display='none';copyDeviceCode.disabled=true;enrollMsg.className='ok';enrollMsg.textContent='Device linked ✓ — press Connect';await refreshStatus();return;}if(['expired','replaced','cancelled'].includes(state)){stopEnrollmentPoll();enrollMsg.className='error';enrollMsg.textContent='Device code '+state+' — create a new code';deviceEnrollmentCode='';copyDeviceCode.disabled=true;await refreshStatus();}}catch(e){if(String(e.message)!=='no_pending_enrollment'){enrollMsg.className='error';enrollMsg.textContent=e.message;}}}
async function beginDeviceEnrollment(){linkDevice.disabled=true;stopEnrollmentPoll();enrollMsg.className='muted';enrollMsg.textContent='Creating one-time device code…';try{const j=await wallMutation('/api/enrollment/begin'),e=j.enrollment||{};deviceEnrollmentCode=String(e.deviceCode||'');if(!deviceEnrollmentCode)throw new Error('device_code_missing');deviceCode.textContent=deviceEnrollmentCode;deviceCodeWrap.style.display='';copyDeviceCode.style.display='';copyDeviceCode.disabled=false;deviceCodeExp.textContent=Math.max(1,Math.ceil((Number(e.expiresAt||Date.now())-Date.now())/60000))+'m';enrollMsg.className='muted';enrollMsg.textContent=(e.mode==='reenroll'?'Re-enroll':'Link')+': enter this code in Account → Add a device';notify('Device link code created','ok');await refreshStatus();enrollmentPollTimer=setInterval(pollDeviceEnrollment,2000);await pollDeviceEnrollment();}catch(e){enrollMsg.className='error';enrollMsg.textContent=e.message;notify(e.message,'error');}finally{linkDevice.disabled=false;}}
async function loadActivity(limit=5000){try{const r=await fetch('/api/activity?limit='+limit,{cache:'no-store'}),d=await r.json();for(const e of (d.events||[]))ingest(e,false);}catch{}}
let es=null;
function openEvents(){if(es||document.hidden)return;es=new EventSource('/events');es.onopen=()=>{conn.textContent='live';conn.className='pill ok';};es.onerror=()=>{conn.textContent='reconnecting';conn.className='pill running';};es.addEventListener('activity',ev=>{try{ingest(JSON.parse(ev.data),true);}catch{}});}
function closeEvents(){if(es){es.close();es=null;}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){closeEvents();return;}loadActivity(500);refreshStatus();openEvents();});
if(document.getElementById('goldModulesPanel')){
async function goldModulesRefresh(){
  const r=await fetch('/api/gold/modules',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'gold_modules_unavailable');
  const f=j.modules||{};
  document.getElementById('goldLongMemory').checked=Boolean(f.longMemory);
  document.getElementById('goldCodexBridge').checked=Boolean(f.codexBridge);
  const live=document.getElementById('goldModulesLiveSummary');
  if(live)live.textContent='Long Memory: '+(f.longMemory?'ON':'OFF')+' · Codex Bridge: '+(f.codexBridge?'ON':'OFF');

  document.getElementById('goldMemoryArea').hidden=!f.longMemory;
  document.getElementById('goldCodexArea').hidden=!f.codexBridge;
  document.getElementById('goldModulesStatus').textContent='Local revision '+String(f.revision||0);
  document.getElementById('goldModulesPanel').dataset.revision=String(f.revision||0);
  for(const [id,on] of [['navMemoryState',f.longMemory],['navCodexState',f.codexBridge]]){
    const el=document.getElementById(id);if(el){el.textContent=on?'ON':'OFF';el.classList.toggle('on',Boolean(on));}
  }
  if(f.longMemory&&location.pathname==='/long-memory'){await goldMemoryRefresh();await goldCheckpointRefresh();
    try{await goldScopeRefresh();}catch(e){document.getElementById('goldScopeStatus').textContent='Scoped Memory unavailable: '+String(e.message||e);}
    try{await goldReaderRefresh();}catch(e){document.getElementById('goldReaderStatus').textContent='Memory Library unavailable: '+String(e.message||e);}
    void goldSimpleSyncRefresh();
  }
  if(f.codexBridge&&location.pathname==='/codex-cli'){await goldObserverRefresh();void goldManagedRuntimeRefresh().catch(e=>{document.getElementById('goldManagedCodexStatus').textContent=String(e.message||e);});}
}
// Wall-native Long Memory organization. Reuse the existing Wall typography, tabs,
// controls, borders and Material icons. Original APIs, IDs and handlers remain intact.
let goldMemoryNative=null;
function goldMemoryNativeElement(tag,className='',label=''){
  const el=document.createElement(tag);if(className)el.className=className;
  if(label)el.textContent=label;return el;
}
function goldMemoryNativeInit(){
  if(location.pathname!=='/long-memory')return;
  const area=document.getElementById('goldMemoryArea');
  if(!area)return;
  const header=goldMemoryNativeElement('div','sessionbox');
  header.style.cssText='margin:0 0 8px;padding:13px';
  const title=goldMemoryNativeElement('strong','','Long Memory');
  title.style.fontSize='17px';
  const intro=goldMemoryNativeElement('p','muted',
    'Your saved work, ready to read and continue across authorized sessions and devices.');
  intro.style.cssText='font-size:12px;margin:6px 0 0';
  header.append(title,intro);
  const tabs=goldMemoryNativeElement('div','tabs');
  tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Long Memory sections');
  tabs.style.margin='9px 0 13px';
  const sections={};
  const pages={};
  for(const [key,label] of [['work','My Work'],['devices','Device Sync'],['settings','Settings']]){
    const button=goldMemoryNativeElement('button','tab',label);
    button.type='button';button.setAttribute('role','tab');
    button.setAttribute('aria-controls','goldMemoryNativePage-'+key);
    button.onclick=()=>goldMemoryNativeShow(key);
    tabs.append(button);sections[key]=button;
    const pane=goldMemoryNativeElement('section');
    pane.id='goldMemoryNativePage-'+key;
    pane.setAttribute('role','tabpanel');pane.hidden=true;
    pages[key]=pane;area.append(pane);
  }
  area.prepend(header,tabs);
  const workList=goldMemoryNativeElement('section','sessionbox');
  workList.id='goldMemoryWorkList';
  workList.style.cssText='padding:13px;margin-bottom:12px';
  const listTop=goldMemoryNativeElement('div','controls');
  listTop.style.cssText='justify-content:space-between;align-items:center;margin-bottom:10px';
  const listHeading=goldMemoryNativeElement('strong','','My Work');
  const add=goldMemoryNativeElement('button','btn small','Add work');
  add.type='button';add.id='goldMemoryAddWork';
  listTop.append(listHeading,add);
  const workHint=goldMemoryNativeElement('p','muted',
    'Select a saved work to read its history or add context. No project setup is required.');
  workHint.style.cssText='font-size:12px;margin:0 0 10px';
  const cards=goldMemoryNativeElement('div');
  cards.id='goldMemoryWorkCards';
  cards.style.cssText='display:grid;gap:8px';
  workList.append(listTop,workHint,cards);
  const create=goldMemoryNativeElement('section','sessionbox');
  create.id='goldMemoryCreateWork';create.hidden=true;
  create.style.cssText='padding:13px;margin-bottom:12px';
  create.append(goldMemoryNativeElement('strong','','Add work'));
  const createHelp=goldMemoryNativeElement('p','muted',
    'Give this work a recognizable name. Memory starts on this device; you can enable authorized sync separately.');
  createHelp.style.cssText='font-size:12px;margin:7px 0';
  const createRow=goldMemoryNativeElement('div','controls');
  const workName=goldMemoryNativeElement('input');
  workName.id='goldMemoryWorkName';workName.maxLength=240;
  workName.placeholder='e.g. Light Remote Gold';
  workName.setAttribute('aria-label','Work name');
  workName.style.minWidth='200px';
  const workMode=goldMemoryNativeElement('select');
  workMode.id='goldMemoryWorkCapture';
  for(const [value,label] of [['manual','Save manually'],['auto','Capture supported activity'],['follow_project','Follow bound project activity']]){
    const opt=goldMemoryNativeElement('option','',label);opt.value=value;workMode.append(opt);
  }
  workMode.setAttribute('aria-label','How to record memory for this work');
  const submit=goldMemoryNativeElement('button','btn small','Create work');
  submit.id='goldMemoryCreateSubmit';submit.type='button';
  const cancel=goldMemoryNativeElement('button','btn small','Cancel');
  cancel.type='button';cancel.onclick=()=>{create.hidden=true;workList.hidden=false;};
  createRow.append(workName,workMode,submit,cancel);
  const createStatus=goldMemoryNativeElement('p','muted');
  createStatus.id='goldMemoryCreateStatus';
  createStatus.style.fontSize='12px';
  create.append(createHelp,createRow,createStatus);
  const detail=goldMemoryNativeElement('section');
  detail.id='goldMemoryWorkDetail';detail.hidden=true;
  const detailBar=goldMemoryNativeElement('div','sessionbox');
  detailBar.style.cssText='padding:11px;margin-bottom:10px';
  const back=goldMemoryNativeElement('button','btn small','All work');
  back.id='goldMemoryBackToWork';back.type='button';back.style.marginRight='10px';
  back.onclick=()=>goldMemoryNativeCloseWork();
  const detailTitle=goldMemoryNativeElement('strong');
  detailTitle.id='goldMemoryWorkTitle';
  detailBar.append(back,detailTitle);
  const capture=goldMemoryNativeElement('div','controls');
  capture.style.cssText='margin:9px 0 0;align-items:center';
  const capLabel=goldMemoryNativeElement('span','muted','Save activity:');
  const capChoice=goldMemoryNativeElement('select');
  capChoice.id='goldMemoryWorkCaptureChoice';
  for(const [value,label] of [['manual','Manual'],['auto','Auto · supported activity'],['follow_project','Follow Project']]){
    const opt=goldMemoryNativeElement('option','',label);opt.value=value;capChoice.append(opt);
  }
  const capSave=goldMemoryNativeElement('button','btn small','Apply');
  capSave.type='button';
  const capStatus=goldMemoryNativeElement('span','muted');
  capStatus.id='goldMemoryWorkCaptureStatus';capStatus.style.fontSize='12px';
  capSave.onclick=async()=>{
    const scopeId=document.getElementById('goldReaderScope').value;
    if(!scopeId)return;
    capSave.disabled=true;
    try{
      await wallMutation('/api/gold/modules/scope/capture',{scopeId,captureMode:capChoice.value});
      await goldScopeRefresh(scopeId);await goldReaderRefresh(scopeId);
      capStatus.textContent='Capture preference saved. This does not capture hidden ChatGPT conversations.';
    }catch(error){capStatus.textContent='Unable to save: '+String(error.message||error);}
    finally{capSave.disabled=false;}
  };
  capture.append(capLabel,capChoice,capSave,capStatus);
  detailBar.append(capture);
  detail.append(detailBar);
  pages.work.append(workList,create,detail);
  pages.devices.append(document.getElementById('goldSimpleSyncPanel'));
  const syncHelp=pages.devices.querySelector('#goldSimpleSyncPanel > p');
  if(syncHelp)syncHelp.textContent='Choose which enrolled devices exchange authorized memory. Each device can have its own transfer mode; this does not change when memory is recorded.';
  const deviceNote=goldMemoryNativeElement('p','muted',
    'Auto transfers saved changes. Follow Project transfers only verified project-bound scopes. Manual requires Sync now. Turning Sync off pauses transfers without deleting saved memory.');
  deviceNote.style.cssText='font-size:12px;margin:10px 0';
  pages.devices.append(deviceNote);
  const settingsIntro=goldMemoryNativeElement('div','sessionbox');
  settingsIntro.style.cssText='padding:12px;margin-bottom:12px';
  settingsIntro.append(goldMemoryNativeElement('strong','','Memory settings'));
  const settingsHelp=goldMemoryNativeElement('p','muted',
    'Long Memory is optional. Advanced tools, legacy notes and technical details are available below.');
  settingsHelp.style.cssText='font-size:12px;margin:7px 0';
  settingsIntro.append(settingsHelp);
  const moduleControls=document.getElementById('goldModulesSave').parentElement;
  settingsIntro.append(moduleControls);
  pages.settings.append(settingsIntro);
  const advanced=document.getElementById('goldAdvancedMemory');
  advanced.querySelector('summary').textContent='Advanced tools · scopes, bindings and checkpoints';
  pages.settings.append(advanced);
  const reader=document.getElementById('goldMemoryReader');
  const firstTitle=reader.querySelector('strong');
  if(firstTitle)firstTitle.textContent='Saved memory';
  const firstHelp=reader.querySelector('p');
  if(firstHelp)firstHelp.textContent='Read verified saved history, or open context and management options when needed.';
  const select=document.getElementById('goldReaderScope');
  select.style.display='none'; // selection is owned by the My Work list, not an extra technical dropdown
  detail.append(reader);
  const context=document.getElementById('goldContextCapture');
  context.querySelector('strong').textContent='Save or read session context';
  context.querySelector('p').textContent='Paste a handoff or choose a file. Gold cannot silently read ChatGPT browser conversations. Accepted context is signed on its Home device.';
  document.getElementById('goldContextRead').textContent='Read saved context';
  document.getElementById('goldContextSave').textContent='Save context';
  const contextDetails=goldMemoryNativeElement('details');
  contextDetails.id='goldMemoryContextDetails';
  contextDetails.style.cssText='margin:10px 0';
  contextDetails.append(goldMemoryNativeElement('summary','','Saved context · read or add session notes'));
  context.replaceWith(contextDetails);contextDetails.append(context);
  const usage=document.getElementById('goldReaderUsage');
  const usageDetails=goldMemoryNativeElement('details');
  usageDetails.id='goldMemoryUsageDetails';
  usageDetails.style.cssText='margin:10px 0';
  usageDetails.append(goldMemoryNativeElement('summary','','Storage and verification details'));
  usage.replaceWith(usageDetails);usageDetails.append(usage);
  const exports=goldMemoryNativeElement('details');
  exports.id='goldMemoryExportDetails';
  exports.style.cssText='margin:9px 0';
  exports.append(goldMemoryNativeElement('summary','','Export saved memory'));
  const exportRow=goldMemoryNativeElement('div','controls');
  exportRow.style.marginTop='8px';
  for(const id of ['goldReaderExportJson','goldReaderExportMd']){
    exportRow.append(document.getElementById(id));
  }
  exports.append(exportRow);
  const readButton=document.getElementById('goldReaderRead');
  readButton.parentElement.after(exports);
  // Keep scoped destructive actions visible in the selected work. Previous UX
  // accidentally hid Delete behind Export > Manage scope (two extra clicks).
  const manage=goldMemoryNativeElement('section','sessionbox');
  manage.id='goldMemoryWorkManage';
  manage.style.cssText='padding:12px;margin:0 0 12px';
  manage.append(goldMemoryNativeElement('strong','','Manage this work'));
  const manageHint=goldMemoryNativeElement('p','muted',
    'Archive keeps signed history. Delete on this device permanently removes only this local copy; other devices and backups are not erased.');
  manageHint.style.cssText='font-size:12px;line-height:1.5;margin:7px 0';
  manage.append(manageHint);
  // Attach the management section before moving controls, otherwise the old
  // controls live in a detached node and document.getElementById returns null.
  detail.insertBefore(manage,reader);
  const managePanel=document.getElementById('goldReaderManagePanel');
  managePanel.style.cssText='border:0;padding:0;margin:8px 0 0';
  manage.append(managePanel);
  const unsupported=document.getElementById('goldReaderDeleteAccount');
  unsupported.textContent='Delete across account · unavailable';
  unsupported.disabled=true;
  unsupported.title='Not yet supported: requires durable signed deletion on offline devices and per-device acknowledgement';
  document.getElementById('goldReaderDeleteLocal').classList.add('danger');
  // Retain the original control for legacy browser handlers, without an
  // additional nested menu in the owner-facing flow.
  document.getElementById('goldReaderManage').style.display='none';
  const archived=goldMemoryNativeElement('div','sessionbox');
  archived.style.cssText='padding:12px;margin:12px 0';
  archived.append(goldMemoryNativeElement('strong','','Archived work'));
  const archivedRow=goldMemoryNativeElement('div','controls');
  archivedRow.style.marginTop='9px';
  archivedRow.append(document.getElementById('goldReaderArchived'),document.getElementById('goldReaderRestore'));
  archived.append(archivedRow);
  pages.settings.insertBefore(archived,pages.settings.querySelector('#goldAdvancedMemory'));
  const oldInfo=document.getElementById('goldModulesPanel').querySelector(':scope > p');
  if(oldInfo)oldInfo.hidden=true;
  add.onclick=()=>{detail.hidden=true;workList.hidden=true;create.hidden=false;workName.focus();};
  submit.onclick=async()=>{
    const name=workName.value.trim();
    if(!name){createStatus.textContent='Enter a name for this work.';workName.focus();return;}
    submit.disabled=true;
    try{
      const j=await wallMutation('/api/gold/modules/scope',
        {displayName:name,captureMode:workMode.value,syncPolicy:'local_only'});
      await goldScopeRefresh(j.scope.scopeId);
      await goldReaderRefresh(j.scope.scopeId);
      create.hidden=true;workName.value='';
      goldMemoryNativeOpenWork(j.scope.scopeId);
    }catch(error){createStatus.textContent='Unable to create work: '+String(error.message||error);}
    finally{submit.disabled=false;}
  };
  goldMemoryNative={sections,pages,workList,cards,create,detail,detailTitle,capChoice};
  goldMemoryNativeShow('work');
}
function goldMemoryNativeShow(name){
  if(!goldMemoryNative)return;
  const {sections,pages}=goldMemoryNative;
  for(const [key,pane] of Object.entries(pages)){
    const selected=key===name;
    pane.hidden=!selected;
    sections[key].classList.toggle('active',selected);
    sections[key].setAttribute('aria-selected',String(selected));
    sections[key].tabIndex=selected?0:-1;
  }
}
function goldMemoryNativeCloseWork(){
  if(!goldMemoryNative)return;
  goldMemoryNative.detail.hidden=true;
  goldMemoryNative.create.hidden=true;
  goldMemoryNative.workList.hidden=false;
}
function goldMemoryNativeOpenWork(id){
  if(!goldMemoryNative)return;
  const option=[...document.getElementById('goldReaderScope').options].find(o=>o.value===id);
  if(!option)return;
  const select=document.getElementById('goldReaderScope');
  select.value=id;
  select.dispatchEvent(new Event('change'));
  const row=(goldMemoryNative.knownScopes||[]).find(s=>s.scopeId===id);
  goldMemoryNative.detailTitle.textContent=row?.displayName||option.textContent;
  goldMemoryNative.capChoice.value=row?.captureMode||'manual';
  goldMemoryNative.workList.hidden=true;
  goldMemoryNative.create.hidden=true;
  goldMemoryNative.detail.hidden=false;
  document.getElementById('goldReaderPreview').hidden=true;
  document.getElementById('goldReaderStatus').textContent='Select Read memory to load the verified history.';
  document.getElementById('goldReaderManagePanel').hidden=false;
  document.getElementById('goldMemoryContextDetails').open=false;
  document.getElementById('goldMemoryExportDetails').open=false;
  document.getElementById('goldMemoryUsageDetails').open=false;
}
function goldMemoryNativeRender(scopes){
  if(!goldMemoryNative)return;
  goldMemoryNative.knownScopes=scopes;
  const host=goldMemoryNative.cards;host.textContent='';
  const active=scopes.filter(scope=>scope.status!=='archived'&&scope.status!=='deleted');
  if(!active.length){
    const empty=goldMemoryNativeElement('div','muted',
      'No saved work yet. Choose Add work to create your first memory space.');
    empty.style.cssText='font-size:12px;padding:12px';
    host.append(empty);
  }
  for(const scope of active){
    const card=goldMemoryNativeElement('button','btn');
    card.type='button';
    card.style.cssText='width:100%;text-align:left;justify-content:flex-start;display:flex;gap:12px;padding:12px;min-height:56px';
    const icon=document.querySelector('a[href="/long-memory"] svg')?.cloneNode(true);
    if(icon)card.append(icon);
    const content=goldMemoryNativeElement('span');
    content.style.cssText='display:flex;flex-direction:column;gap:3px;flex:1;min-width:0';
    const name=goldMemoryNativeElement('strong','',scope.displayName);
    const state=goldMemoryNativeElement('span','muted',
      Number(scope.revision)>0?'Saved history available':'No checkpoints yet');
    state.style.fontSize='11px';
    content.append(name,state);
    card.append(content,goldMemoryNativeElement('span','muted','Open'));
    card.onclick=()=>goldMemoryNativeOpenWork(scope.scopeId);
    host.append(card);
  }
  const current=document.getElementById('goldReaderScope').value;
  if(goldMemoryNative.detail.hidden===false&&
    !active.some(scope=>scope.scopeId===current))goldMemoryNativeCloseWork();
}
goldMemoryNativeInit();

// Owner-authenticated local Memory Library; neither export nor preview mutates state.
async function goldReaderRefresh(preferred=''){
  const r=await fetch('/api/gold/modules/scopes',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'memory_scopes_unavailable');
  const sel=document.getElementById('goldReaderScope'),old=preferred||sel.value;
  sel.textContent='';
  const empty=document.createElement('option');empty.value='';empty.textContent='Choose a memory scope';sel.appendChild(empty);
  for(const scope of j.scopes||[]){
    const opt=document.createElement('option');opt.value=scope.scopeId;
    opt.textContent=scope.displayName+' · revision '+String(scope.revision)+' · capture '+scope.captureMode;sel.appendChild(opt);
  }
  if(old&&(j.scopes||[]).some(s=>s.scopeId===old))sel.value=old;
  goldMemoryNativeRender(j.scopes||[]);
  void goldReaderUsageRefresh().catch(e=>{document.getElementById('goldReaderUsage').textContent=String(e.message||e);});
  void goldReaderPreferenceRefresh().catch(e=>{document.getElementById('goldContextStatus').textContent=String(e.message||e);});
  document.getElementById('goldReaderStatus').textContent=
    'Local scopes: '+String((j.scopes||[]).length)+' · Select a scope to read or export its current verified epoch.';
}
async function goldReaderRequest(full=false){
  const id=document.getElementById('goldReaderScope').value;
  if(!id)throw Error('Select a memory scope first');
  const path='/api/gold/modules/scope/'+(full?'export':'handoff')+'?scopeId='+encodeURIComponent(id);
  const r=await fetch(path,{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'memory_read_unavailable');
  return full?j.export:j.handoff;
}
function goldReaderText(data){
  const nl=String.fromCharCode(10);
  const lines=['Saved history for '+data.displayName,
    'Entries: '+(data.checkpoints||[]).length,''];
  for(const item of data.checkpoints||[]){
    lines.push(item.title||item.kind||'Saved entry');
    lines.push('Source: '+(item.source||'not specified'));
    lines.push(String(item.body||''),'');
  }
  return lines.join(nl);
}
async function goldReaderRead(){
  const d=await goldReaderRequest(false);
  const preview=document.getElementById('goldReaderPreview');
  preview.hidden=false;preview.textContent=goldReaderText(d);
  document.getElementById('goldReaderStatus').textContent=
    'Loaded '+(d.checkpoints||[]).length+' entries from verified saved history.';
}
async function goldReaderExport(kind){
  const d=await goldReaderRequest(true);
  if(d.integrity!=='all_current_epoch_revisions_verified'||
     d.checkpointCount!==(d.checkpoints||[]).length)throw Error('Memory export integrity check failed');
  const json=kind==='json';
  const text=json?JSON.stringify(d,null,2):
    '# '+d.displayName+String.fromCharCode(10)+
    'Verified current-epoch Long Memory export · revision '+d.revision+String.fromCharCode(10)+
    'Home epoch: '+d.homeEpoch+String.fromCharCode(10)+
    'Head hash: '+d.headHash+String.fromCharCode(10,10)+goldReaderText(d);
  const fileName='light-remote-memory-'+d.scopeId+'.'+(json?'json':'md');
  const blob=new Blob([text],{type:json?'application/json;charset=utf-8':'text/markdown;charset=utf-8'});
  const href=URL.createObjectURL(blob),anchor=document.createElement('a');
  try{
    anchor.href=href;anchor.download=fileName;document.body.appendChild(anchor);anchor.click();
  }finally{
    anchor.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  document.getElementById('goldReaderStatus').textContent=
    'Exported '+d.checkpointCount+' verified checkpoints (current epoch) · '+fileName+
    ' · Keep this sensitive file private.';
}
let goldMemoryUsageCache=null, goldContextInputSource='owner_paste';
function goldReaderSelected(){
  const id=document.getElementById('goldReaderScope').value;
  if(!id)throw Error('Choose a Memory scope');
  return id;
}
function goldHumanBytes(value){
  const n=Number(value)||0;
  return n>=1024*1024?(n/1048576).toFixed(2)+' MiB':
    n>=1024?(n/1024).toFixed(1)+' KiB':n+' B';
}
function goldSyncStamp(ms){
  return Number.isSafeInteger(ms)&&ms>0?new Date(ms).toLocaleString():'Never verified';
}
async function goldReaderUsageRefresh(){
  const r=await fetch('/api/gold/modules/memory/usage',{cache:'no-store'});
  const j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'memory_usage_unavailable');
  goldMemoryUsageCache=j.usage;
  const verified=document.getElementById('goldSimpleSyncVerified');
  if(verified){
    const peers=(j.usage.deviceSync||[]).map(x=>x.deviceId+': '+goldSyncStamp(x.lastAckAt));
    verified.textContent='Last verified transfer: '+goldSyncStamp(j.usage.lastConfirmedSyncAt);
  }
  const u=j.usage,scope=(u.scopes||[]).find(s=>s.scopeId===document.getElementById('goldReaderScope').value);
  document.getElementById('goldReaderUsage').textContent=
    'Local Gold database files (including WAL): '+goldHumanBytes(u.localFileBytes)+
    ' · Database allocated: '+goldHumanBytes(u.localDatabaseBytes)+
    ' (live pages '+goldHumanBytes(u.localDatabaseLiveBytes)+') · Signed checkpoint content: '+
    goldHumanBytes(u.checkpointBodyBytes)+
    ' · Last verified sync: '+goldSyncStamp(u.lastConfirmedSyncAt)+
    (scope?' · Selected scope: '+goldHumanBytes(scope.checkpointBodyBytes)+
      ' / '+scope.checkpoints+' checkpoints · synced '+goldSyncStamp(scope.lastConfirmedSyncAt):'')+
    ' · No remote device totals included.';
  const select=document.getElementById('goldReaderArchived'),before=select.value;
  select.textContent='';
  const blank=document.createElement('option');blank.value='';blank.textContent='Archived scopes';select.append(blank);
  for(const row of u.scopes||[])if(row.status==='archived'){
    const o=document.createElement('option');o.value=row.scopeId;
    o.textContent=row.displayName+(row.tombstoned?' · deleted locally':' · archived');
    o.disabled=row.tombstoned===true;
    select.append(o);
  }
  if(before&&[...select.options].some(o=>o.value===before&&!o.disabled))select.value=before;
}
async function goldReaderPreferenceRefresh(){
  const id=document.getElementById('goldReaderScope').value;
  const box=document.getElementById('goldContextOptIn');
  if(!id){box.checked=false;box.disabled=true;return;}
  const r=await fetch('/api/gold/modules/scope/context/preference?scopeId='+encodeURIComponent(id),{cache:'no-store'});
  const j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'context_preference_unavailable');
  box.disabled=false;box.checked=Boolean(j.preference.fullContextOptIn);
}
document.getElementById('goldReaderScope').addEventListener('change',()=>{
  void goldReaderUsageRefresh().catch(e=>{document.getElementById('goldReaderUsage').textContent=String(e.message||e);});
  void goldReaderPreferenceRefresh().catch(e=>{document.getElementById('goldContextStatus').textContent=String(e.message||e);});
});
document.getElementById('goldReaderManage').onclick=()=>{
  const e=document.getElementById('goldReaderManagePanel');e.hidden=!e.hidden;
  if(!e.hidden)void goldReaderUsageRefresh();
};
document.getElementById('goldReaderArchive').onclick=async()=>{
  const status=document.getElementById('goldReaderManageStatus');
  try{
    const scopeId=goldReaderSelected(),name=goldMemoryUsageCache?.scopes?.find(s=>s.scopeId===scopeId)?.displayName||scopeId;
    if(!confirm('Archive '+name+'? Capture and new sync for this scope will stop; the existing signed history is retained.'))return;
    await wallMutation('/api/gold/modules/scope/archive',{scopeId,ownerConfirmed:true});
    status.textContent='Archived '+name+'; signed history retained.';
    await goldReaderRefresh();await goldReaderUsageRefresh();
  }catch(e){status.textContent=String(e.message||e);}
};
document.getElementById('goldReaderRestore').onclick=async()=>{
  const status=document.getElementById('goldReaderManageStatus'),scopeId=document.getElementById('goldReaderArchived').value;
  if(!scopeId){status.textContent='Choose an archived scope';return;}
  try{
    if(!confirm('Restore this archived scope locally? It may resume receiving authorized updates.'))return;
    await wallMutation('/api/gold/modules/scope/restore',{scopeId,ownerConfirmed:true});
    await goldReaderRefresh(scopeId);await goldReaderUsageRefresh();
    status.textContent='Archived scope restored. Sync policy still applies.';
  }catch(e){status.textContent=String(e.message||e);}
};
document.getElementById('goldReaderDeleteLocal').onclick=async()=>{
  const status=document.getElementById('goldReaderManageStatus');
  try{
    const scopeId=goldReaderSelected(),row=goldMemoryUsageCache?.scopes?.find(s=>s.scopeId===scopeId);
    if(!row)throw Error('Refresh storage and choose a scope first');
    const name=row.displayName;
    const typed=prompt('Delete local checkpoints for '+name+'? Other devices and backups remain unchanged. To confirm, type the exact scope name:');
    if(typed!==name){status.textContent='Canceled: scope name not confirmed.';return;}
    if(!confirm('Permanently remove this scope’s local content and retain a tombstone preventing stale resync on this device?'))return;
    const j=await wallMutation('/api/gold/modules/scope/delete/local',
      {scopeId,confirmName:typed,ownerConfirmed:true});
    status.textContent='Deleted locally: '+j.result.checkpointsDeleted+' checkpoints. Replica copies were NOT erased.';
    document.getElementById('goldReaderPreview').hidden=true;
    await goldReaderRefresh();await goldReaderUsageRefresh();
  }catch(e){status.textContent=String(e.message||e);}
};
document.getElementById('goldContextOptIn').onchange=async()=>{
  const box=document.getElementById('goldContextOptIn'),status=document.getElementById('goldContextStatus');
  try{
    const j=await wallMutation('/api/gold/modules/scope/context/preference',
      {scopeId:goldReaderSelected(),enabled:box.checked});
    status.textContent=j.preference.fullContextOptIn?
      'Full context import enabled for this scope; still requires explicit text/file and Save.':
      'Full context import disabled. Previously signed snapshots are retained.';
  }catch(e){box.checked=!box.checked;status.textContent=String(e.message||e);}
};
document.getElementById('goldContextFile').onchange=async()=>{
  const f=document.getElementById('goldContextFile').files?.[0],status=document.getElementById('goldContextStatus');
  if(!f)return;
  if(f.size>512*1024){status.textContent='File exceeds 512 KiB; no content imported.';return;}
  try{
    document.getElementById('goldContextText').value=await f.text();
    goldContextInputSource='owner_file';
    status.textContent='Loaded '+f.name+' locally. Click Save complete context to persist a signed snapshot.';
  }catch(e){status.textContent=String(e.message||e);}
};
document.getElementById('goldContextText').addEventListener('input',()=>{goldContextInputSource='owner_paste';});
document.getElementById('goldContextSave').onclick=async()=>{
  const status=document.getElementById('goldContextStatus'),btn=document.getElementById('goldContextSave');
  btn.disabled=true;
  try{
    if(!document.getElementById('goldContextOptIn').checked)throw Error('Enable full-context capture for this scope first');
    const text=document.getElementById('goldContextText').value;
    if(!text.trim())throw Error('Paste or import content first');
    if(new TextEncoder().encode(text).byteLength>512*1024)throw Error('Text exceeds 512 KiB');
    if(!confirm('Save the exact owner-provided text as signed scope checkpoints? It may contain sensitive information.'))return;
    const j=await wallMutation('/api/gold/modules/scope/context/save',{
      scopeId:goldReaderSelected(),title:document.getElementById('goldContextTitle').value||'Complete session context',
      text,source:goldContextInputSource,confirmed:true
    });
    status.textContent='Saved '+goldHumanBytes(j.snapshot.bytes)+
      ' in '+j.snapshot.parts+' signed parts, revision '+j.snapshot.lastRevision+'.';
    await goldReaderRefresh(goldReaderSelected());await goldReaderUsageRefresh();
  }catch(e){status.textContent=String(e.message||e);}
  finally{btn.disabled=false;}
};
document.getElementById('goldContextRead').onclick=async()=>{
  const status=document.getElementById('goldContextStatus');
  try{
    const r=await fetch('/api/gold/modules/scope/context/read?scopeId='+encodeURIComponent(goldReaderSelected()),{cache:'no-store'});
    const j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'verified_context_read_unavailable');
    if(!j.context.available){status.textContent='No user-provided full context saved for this scope.';return;}
    document.getElementById('goldContextText').value=j.context.text;
    status.textContent='Restored '+goldHumanBytes(j.context.bytes)+' · '+j.context.integrity+
      ' · revision '+j.context.checkpointRevision+'. Use this verified text in a new session as needed.';
  }catch(e){status.textContent=String(e.message||e);}
};
for(const [id,action] of [['goldReaderRead',()=>goldReaderRead()],
  ['goldReaderExportJson',()=>goldReaderExport('json')],
  ['goldReaderExportMd',()=>goldReaderExport('md')]]){
  document.getElementById(id).onclick=async()=>{
    const button=document.getElementById(id);button.disabled=true;
    try{await action();}
    catch(error){document.getElementById('goldReaderStatus').textContent=String(error.message||error);}
    finally{button.disabled=false;}
  };
}
async function goldScopeRefresh(preferred=''){
  const r=await fetch('/api/gold/modules/scopes',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'gold_scopes_unavailable');
  const sel=document.getElementById('goldScopeSelect'),chosen=preferred||sel.value;
  sel.textContent='';
  const opt=document.createElement('option');opt.value='';opt.textContent='Choose a memory scope';sel.appendChild(opt);
  for(const s of j.scopes||[]){
    const o=document.createElement('option');o.value=s.scopeId;
    o.textContent=s.displayName+' · rev '+s.revision+' · '+s.captureMode;
    sel.appendChild(o);
  }
  if(chosen&&(j.scopes||[]).some(s=>s.scopeId===chosen))sel.value=chosen;
  const active=(j.scopes||[]).find(s=>s.scopeId===sel.value);
  if(active){document.getElementById('goldScopeCapture').value=active.captureMode;
    document.getElementById('goldScopeSyncPolicy').value=active.syncPolicy||'local_only';
  }
  document.getElementById('goldScopeStatus').textContent=
    'Scopes: '+String(j.scopes?.length||0)+' · Legacy V1 unassigned: '+String(j.legacyUnassigned||0);
}
document.getElementById('goldScopeRefresh').onclick=()=>goldScopeRefresh().catch(e=>{
  document.getElementById('goldScopeStatus').textContent=String(e.message||e);
});
document.getElementById('goldScopeSelect').onchange=()=>goldScopeRefresh().catch(e=>{
  document.getElementById('goldScopeStatus').textContent=String(e.message||e);
});
document.getElementById('goldScopeCreate').onclick=async()=>{
  try{
    const j=await wallMutation('/api/gold/modules/scope',{
      displayName:document.getElementById('goldScopeName').value,
      captureMode:document.getElementById('goldScopeCapture').value,
      syncPolicy:'local_only'
    });
    document.getElementById('goldScopeName').value='';
    await goldScopeRefresh(j.scope.scopeId);
  }catch(e){document.getElementById('goldScopeStatus').textContent=String(e.message||e);}
};
document.getElementById('goldScopeApplyMode').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select a scope first');
    await wallMutation('/api/gold/modules/scope/capture',{
      scopeId,captureMode:document.getElementById('goldScopeCapture').value
    });
    await goldScopeRefresh(scopeId);
  }catch(e){document.getElementById('goldScopeStatus').textContent=String(e.message||e);}
};
document.getElementById('goldScopeSyncApply').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select a memory scope first');
    const policy=document.getElementById('goldScopeSyncPolicy').value;
    await wallMutation('/api/gold/modules/scope/sync/policy',{scopeId,syncPolicy:policy});
    await goldScopeRefresh(scopeId);
    document.getElementById('goldSyncStatusText').textContent=
      'Policy saved: '+policy+'. Peer transport not connected yet; no data has been transmitted.';
  }catch(e){document.getElementById('goldSyncStatusText').textContent=String(e.message||e);}
};
document.getElementById('goldScopeSyncStatus').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select a memory scope first');
    const r=await fetch('/api/gold/modules/scope/sync/status?scopeId='+encodeURIComponent(scopeId),{cache:'no-store'});
    const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'sync_status_unavailable');
    const sync=data.sync;
    const reports=(sync.peers||[]).filter(peer=>!peer.revokedAt).map(peer=>{
      const complete=Number.isInteger(peer.ackRevision)&&peer.ackRevision>=sync.localRevision;
      const label=complete?'Up to date':peer.ackRevision==null?'Pending':'Pending · '+(sync.localRevision-peer.ackRevision)+' revision';
      return peer.deviceId+' · '+label;
    });
    document.getElementById('goldSyncStatusText').textContent=
      'Scope '+sync.scopeId+' · '+(sync.isHome?'Home':'Replica')+
      ' · Local revision '+sync.localRevision+
      '\\n'+(reports.join('\\n')||'No active sync peers yet')+
      '\\nTransport: automatic account E2EE relay (fallback), or authorized direct peer route.';
  }catch(e){document.getElementById('goldSyncStatusText').textContent=String(e.message||e);}
};
document.getElementById('goldSyncIdentityShow').onclick=async()=>{
  try{
    const r=await fetch('/api/gold/modules/sync/identity',{cache:'no-store'});
    const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'sync_identity_unavailable');
    document.getElementById('goldSyncStatusText').textContent=
      'Device: '+data.identity.deviceId+'\\nPublic key fingerprint: '+data.identity.fingerprint+
      '\\nVerify this fingerprint out of band before granting another device access.';
  }catch(e){document.getElementById('goldSyncStatusText').textContent=String(e.message||e);}
};
function goldPairOwnerApproved(){
  if(!document.getElementById('goldPeerOwnerApproval').checked)
    throw Error('Owner confirmation required; verify both device fingerprints');
}
function goldPairJson(id,maxLength=8000){
  const raw=document.getElementById(id).value.trim();
  if(!raw||raw.length>maxLength)throw Error('Invalid or oversized public pairing metadata');
  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid pairing JSON');
  return parsed;
}
function goldPairOutput(message){
  document.getElementById('goldPeerPairStatus').textContent=message;
}
function goldPairClearApproval(){
  document.getElementById('goldPeerOwnerApproval').checked=false;
}
document.getElementById('goldPeerExportIdentity').onclick=async()=>{
  try{
    const r=await fetch('/api/gold/modules/sync/identity',{cache:'no-store'});
    const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'identity_unavailable');
    document.getElementById('goldPeerMyIdentity').value=JSON.stringify(j.identity,null,2);
    goldPairOutput('Public keys only. Verify fingerprint on this Wall separately: '+j.identity.fingerprint);
  }catch(e){goldPairOutput(String(e.message||e));}
};
async function goldCopyPublicPairing(fieldId){
  const field=document.getElementById(fieldId);
  if(!field.value)throw Error('Nothing to copy yet');
  if(navigator.clipboard&&window.isSecureContext){
    await navigator.clipboard.writeText(field.value);
    goldPairOutput('Public pairing metadata copied. Confirm its fingerprint out of band.');
  }else{
    field.focus();field.select();
    goldPairOutput('Selected pairing metadata. Press Ctrl+C to copy on this HTTP Wall.');
  }
}
document.getElementById('goldPeerCopyIdentity').onclick=()=>goldCopyPublicPairing('goldPeerMyIdentity')
  .catch(e=>goldPairOutput(String(e.message||e)));
document.getElementById('goldPeerCopyInvite').onclick=()=>goldCopyPublicPairing('goldPeerInviteOutput')
  .catch(e=>goldPairOutput(String(e.message||e)));
document.getElementById('goldPeerGrant').onclick=async()=>{
  try{
    goldPairOwnerApproved();
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select the exact Home scope first');
    const peer=goldPairJson('goldPeerCandidate',5000);
    const expectedFingerprint=document.getElementById('goldPeerExpectedFingerprint').value.trim().toLowerCase();
    if(!/^[0-9a-f]{32}$/.test(expectedFingerprint))
      throw Error('Enter the verified 32-character Replica fingerprint');
    if(peer.fingerprint!==expectedFingerprint)
      throw Error('The pasted identity does not match the separately verified fingerprint');
    const j=await wallMutation('/api/gold/modules/scope/sync/grant',{
      scopeId,peer,expectedFingerprint,ownerConfirmed:true
    });
    document.getElementById('goldPeerInviteOutput').value=JSON.stringify(j.grant,null,2);
    goldPairOutput('Grant created for '+peer.deviceId+'. Copy the signed invitation to that Replica Wall.');
    goldPairClearApproval();
  }catch(e){goldPairOutput(String(e.message||e));}
};
document.getElementById('goldPeerAccept').onclick=async()=>{
  try{
    goldPairOwnerApproved();
    const pkg=goldPairJson('goldPeerInviteInput');
    const expectedHomeFingerprint=document.getElementById('goldPeerHomeFingerprint').value.trim().toLowerCase();
    if(!/^[0-9a-f]{32}$/.test(expectedHomeFingerprint))
      throw Error('Enter the verified 32-character Home fingerprint');
    const j=await wallMutation('/api/gold/modules/scope/sync/accept',{
      package:pkg,expectedHomeFingerprint,ownerConfirmed:true
    });
    await goldScopeRefresh(j.replica.scopeId);
    goldPairOutput('Replica authorized for scope '+j.replica.scopeId+
      '. Polling remains OFF until the NetBird route is explicitly enabled.');
    goldPairClearApproval();
  }catch(e){goldPairOutput(String(e.message||e));}
};
document.getElementById('goldPeerRevoke').onclick=async()=>{
  try{
    goldPairOwnerApproved();
    const scopeId=document.getElementById('goldScopeSelect').value;
    const replicaDeviceId=document.getElementById('goldPeerRevokeDevice').value.trim();
    if(!scopeId||!replicaDeviceId)throw Error('Select scope and enter exact Replica device ID');
    const j=await wallMutation('/api/gold/modules/scope/sync/revoke',{
      scopeId,replicaDeviceId,ownerConfirmed:true
    });
    goldPairOutput('Revoked '+j.revoke.deviceId+
      '. Already downloaded data cannot be erased from a disconnected replica.');
    goldPairClearApproval();
  }catch(e){goldPairOutput(String(e.message||e));}
};
async function goldRefreshAccountDevices(){
  const target=document.getElementById('goldPeerAccountDevices');
  target.textContent='Reading signed account device directory…';
  try{
    const response=await fetch('/api/gold/modules/sync/account-devices',{cache:'no-store'});
    const result=await response.json();
    if(!response.ok||!result.ok||!Array.isArray(result.devices))
      throw Error(result.error||'account_device_directory_unavailable');
    target.textContent='';
    if(!result.devices.length){
      target.textContent='No enrolled devices for this Light Remote account.';
      return;
    }
    const selector=document.getElementById('goldSyncReplicaSelect');
    const previous=selector.value;selector.textContent='';
    const empty=document.createElement('option');empty.value='';
    empty.textContent='Choose Replica device';selector.append(empty);
    const heading=document.createElement('div');
    heading.textContent='Devices registered to this account ('+result.devices.length+')';
    target.append(heading);
    for(const device of result.devices){
      const row=document.createElement('div');
      row.style.cssText='margin:5px 0;padding:7px 9px;border:1px solid #2b3d4d;border-radius:6px';
      const same=device.deviceId===result.currentDeviceId;
      row.textContent=String(device.displayName||device.deviceId)+
        (same?' · This device':'')+
        ' · '+String(device.platform||'device')+
        ' · '+(device.state==='offline'?'Offline':String(device.state||'unknown'));
      row.dataset.deviceId=device.deviceId;
      if(device.memoryIdentity&&device.deviceId!==result.currentDeviceId){
        const option=document.createElement('option');
        option.value=device.deviceId;
        option.textContent=String(device.displayName||device.deviceId)+' · Memory ready';
        selector.append(option);
      }
      if(device.deviceId!==result.currentDeviceId&&!device.memoryIdentity)
        row.textContent+=' · Memory not available (cannot authorize yet)';
      target.append(row);
    }
    const note=document.createElement('div');
    note.style.cssText='font-size:11px;margin-top:8px';
    note.textContent='Select the active scope on its Home device, then authorize a Memory-ready Replica. Peer transport is still being implemented.';
    target.append(note);
    selector.value=previous;
  }catch(e){
    target.textContent='Account device directory unavailable. No sync route has been changed.';
  }
}
document.getElementById('goldPeerAccountDevicesRefresh').onclick=goldRefreshAccountDevices;
// Account-wide Memory Sync: shared device membership with individual sync modes.
let goldSimpleSyncSaving=false,goldAccountPolicyRevision=0;
const syncModes=['auto','follow_project','manual'];
const syncModeNames={auto:'Auto',follow_project:'Follow Project',manual:'Manual'};
async function goldSimpleSyncRefresh(){
  const host=document.getElementById('goldSimpleSyncDevices');
  const info=document.getElementById('goldSimpleSyncState');
  try{
    const [policyRes,devicesRes]=await Promise.all([
      fetch('/api/gold/modules/sync/account-policy',{cache:'no-store'}),
      fetch('/api/gold/modules/sync/account-devices',{cache:'no-store'})
    ]);
    const policyJson=await policyRes.json(),directory=await devicesRes.json();
    if(!policyRes.ok||!devicesRes.ok||!policyJson.ok||!directory.ok)
      throw Error(policyJson.error||directory.error||'Account Sync unavailable');
    const policy=policyJson.policy;
    goldAccountPolicyRevision=policy.revision;
    document.getElementById('goldSimpleSyncEnabled').checked=Boolean(policy.enabled);
    host.textContent='';
    const selectedMap=new Map((policy.devices||[]).map(d=>[d.deviceId,d]));
    for(const device of directory.devices||[]){
      const cfg=selectedMap.get(device.deviceId)||{selected:false,mode:'auto'};
      const row=document.createElement('div');
      row.className='gold-sync-device-row';
      row.dataset.deviceId=device.deviceId;
      row.dataset.mode=cfg.mode;
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #304158;border-radius:7px;flex-wrap:wrap';
      const check=document.createElement('input');check.type='checkbox';
      check.className='gold-simple-sync-device';check.checked=Boolean(cfg.selected);
      check.setAttribute('aria-label','Sync '+String(device.displayName||device.deviceId));
      const name=document.createElement('span');
      name.style.minWidth='180px';
      name.textContent=String(device.displayName||device.deviceId)+
        (device.deviceId===directory.currentDeviceId?' · This device':'');
      const group=document.createElement('div');
      group.setAttribute('role','group');group.setAttribute('aria-label','Sync mode for '+String(device.displayName||device.deviceId));
      group.style.cssText='display:flex;gap:3px;flex-wrap:wrap';
      for(const mode of syncModes){
        const b=document.createElement('button');b.type='button';b.className='btn small';
        b.dataset.mode=mode;b.textContent=syncModeNames[mode];
        b.setAttribute('aria-pressed',String(mode===cfg.mode));
        b.style.opacity=mode===cfg.mode?'1':'.65';
        b.disabled=!check.checked;
        b.onclick=()=>{row.dataset.mode=mode;void goldSimpleSyncSave();};
        group.append(b);
      }
      const state=document.createElement('span');state.className='muted';state.style.marginLeft='auto';
      state.style.fontSize='11px';
      state.textContent=!check.checked?'Not selected':!policy.enabled?'Paused':
        device.state==='offline'?'Offline':
        !device.memoryIdentity?'Connecting':
        device.memoryIdentity.syncModeProtocol!==1?'Client update required':
        cfg.mode==='follow_project'?'Project-bound scopes only':
        cfg.mode==='manual'?'On demand':'Sync enabled · Check scope revisions';
      row.append(check,name,group,state);
      if(cfg.selected&&cfg.mode==='manual'){
        const now=document.createElement('button');now.className='btn small';now.type='button';
        now.textContent='Sync now';now.disabled=!policy.enabled;
        now.onclick=async()=>{try{
          const result=await wallMutation('/api/gold/modules/sync/manual',{deviceId:device.deviceId});
          info.textContent='Manual sync requested · '+result.manual.manualRequestSeq;
        }catch(error){info.textContent='Sync request failed: '+String(error.message||error);}};
        row.append(now);
      }
      check.onchange=()=>void goldSimpleSyncSave();
      host.append(row);
    }
    if(!host.children.length)host.textContent='No enrolled devices found in this account.';
    info.textContent=policy.enabled?'Sync ON · Shared account configuration':
      'Sync OFF · Account transfers paused';
  }catch(error){info.textContent='Unable to load sync settings: '+String(error.message||error);}
}
async function goldSimpleSyncSave(){
  if(goldSimpleSyncSaving)return;
  const info=document.getElementById('goldSimpleSyncState');
  goldSimpleSyncSaving=true;
  try{
    const enabled=document.getElementById('goldSimpleSyncEnabled').checked;
    const devices=[...document.querySelectorAll('.gold-sync-device-row')].map(row=>({
      deviceId:row.dataset.deviceId,
      selected:Boolean(row.querySelector('.gold-simple-sync-device:checked')),
      mode:row.dataset.mode||'auto'
    }));
    info.textContent='Saving account sync settings…';
    await wallMutation('/api/gold/modules/sync/account-policy',{
      enabled,devices,expectedRevision:goldAccountPolicyRevision
    });
    await goldSimpleSyncRefresh();
  }catch(error){
    info.textContent='Unable to save settings: '+String(error.message||error);
    // Another device may have changed the policy; refresh instead of overwrite.
    await goldSimpleSyncRefresh();
  }finally{goldSimpleSyncSaving=false;}
}
document.getElementById('goldSimpleSyncEnabled').onchange=()=>void goldSimpleSyncSave();
setInterval(()=>{
  const panel=document.getElementById('goldSimpleSyncPanel');
  if(!goldSimpleSyncSaving&&panel&&panel.offsetParent!==null)
    void goldSimpleSyncRefresh();
},20000);

document.getElementById('goldSyncOffer').onclick=async()=>{
  const status=document.getElementById('goldSyncStatusText');
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    const replicaDeviceId=document.getElementById('goldSyncReplicaSelect').value;
    if(!scopeId||!replicaDeviceId)throw Error('Choose a Home scope and an enrolled Replica');
    if(!document.getElementById('goldSyncOwnerConfirm').checked)
      throw Error('Approve this exact scope and Replica first');
    const saved=await wallMutation('/api/gold/modules/sync/offer',{
      scopeId,replicaDeviceId,ownerConfirmed:true
    });
    status.textContent='Signed scope invitation delivered to '+replicaDeviceId+
      '. Waiting for the owner to approve it on the Replica Wall. No Memory content transferred.';
    document.getElementById('goldSyncOwnerConfirm').checked=false;
    await goldScopeRefresh(scopeId);
  }catch(error){
    const message=String(error.message||error);
    status.textContent=message.includes('gold_sync_peer_key_rotation_requires_regrant')?
      'This device has a newer Memory identity. Revoke the old grant for this Scope, then explicitly authorize it again.':
      'Invitation not created: '+message;
  }
};
document.getElementById('goldSyncRevoke').onclick=async()=>{
  const status=document.getElementById('goldSyncStatusText');
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    const replicaDeviceId=document.getElementById('goldSyncReplicaSelect').value;
    if(!scopeId||!replicaDeviceId)throw Error('Choose the exact Home scope and Replica');
    if(!document.getElementById('goldSyncOwnerConfirm').checked)
      throw Error('Explicit owner confirmation required for this scope change');
    if(!confirm("Revoke this Replica's access to the selected Memory Scope? Already downloaded data cannot be erased remotely."))
      return;
    await wallMutation('/api/gold/modules/scope/sync/revoke',{
      scopeId,replicaDeviceId,ownerConfirmed:true
    });
    document.getElementById('goldSyncOwnerConfirm').checked=false;
    status.textContent='Access revoked for '+replicaDeviceId+' on this Scope. You can now explicitly authorize the current Memory identity again.';
    await goldScopeRefresh(scopeId);
  }catch(error){status.textContent='Revocation failed: '+String(error.message||error);}
};
async function goldRefreshSyncInbox(){
  const target=document.getElementById('goldSyncInbox');target.textContent='Checking owner invitations…';
  try{
    const response=await fetch('/api/gold/modules/sync/inbox',{cache:'no-store'});
    const result=await response.json();
    if(!response.ok||!result.ok)throw Error(result.error||'memory_inbox_unavailable');
    target.textContent='';
    if(!result.invites.length){target.textContent='No invitations awaiting approval.';return;}
    for(const invite of result.invites){
      const row=document.createElement('div');row.className='controls';
      row.style.cssText='margin:5px 0;padding:7px;border:1px solid #304158;border-radius:7px;flex-wrap:wrap';
      const name=document.createElement('span');
      name.textContent=String(invite.scopeName||invite.scopeId)+' · Home '+invite.homeDeviceId;
      const approve=document.createElement('button');approve.type='button';approve.className='btn small';
      approve.textContent='Approve on this Replica';
      approve.onclick=async()=>{
        if(!confirm('Approve Memory scope '+String(invite.scopeName)+' from '+invite.homeDeviceId+
          ' on this device? This grants only the selected scope.'))return;
        try{
          const data=await wallMutation('/api/gold/modules/sync/accept-device',{
            inviteId:invite.inviteId,ownerConfirmed:true
          });
          document.getElementById('goldSyncStatusText').textContent=
            'Replica scope '+data.replica.scopeId+' approved. Waiting for a verified sync route.';
          await goldScopeRefresh(data.replica.scopeId);
          await goldRefreshSyncInbox();
        }catch(e){document.getElementById('goldSyncStatusText').textContent=String(e.message||e);}
      };
      row.append(name,approve);target.append(row);
    }
  }catch(e){target.textContent='Cannot read invitations: '+String(e.message||e);}
}
document.getElementById('goldSyncInboxRefresh').onclick=goldRefreshSyncInbox;
document.getElementById('goldPeerRouteSave').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select an authorized Replica scope');
    const r=await wallMutation('/api/gold/modules/scope/sync/route',{
      scopeId,homeUrl:document.getElementById('goldPeerHomeUrl').value,
      enabled:document.getElementById('goldPeerEnabled').checked
    });
    document.getElementById('goldSyncStatusText').textContent=
      'Replica route saved: '+r.route.homeUrl+'. Polling '+(r.route.enabled?'ON':'OFF')+
      '. Home checkpoint is authoritative.';
  }catch(e){document.getElementById('goldSyncStatusText').textContent=String(e.message||e);}
};
document.getElementById('goldScopeBind').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select the scope before binding a workspace');
    await wallMutation('/api/gold/modules/scope/bind',{
      scopeId,sourceType:document.getElementById('goldScopeBindingType').value,
      sourceId:document.getElementById('goldScopeBindingId').value,
      proofType:'owner_explicit'
    });
    document.getElementById('goldScopeStatus').textContent='Workspace binding saved under selected scope';
  }catch(e){document.getElementById('goldScopeStatus').textContent=String(e.message||e);}
};
document.getElementById('goldScopedSave').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select a scope; unassigned V1 is not canonical memory');
    const j=await wallMutation('/api/gold/modules/scope/checkpoint',{
      scopeId,kind:'checkpoint',status:'owner_approved',
      title:document.getElementById('goldCheckpointTitle').value,
      body:document.getElementById('goldMemoryBody').value,
      source:document.getElementById('goldMemorySource').value
    });
    document.getElementById('goldScopeStatus').textContent='Signed scoped checkpoint revision '+j.checkpoint.revision;
    document.getElementById('goldMemoryBody').value='';
    await goldScopeRefresh(scopeId);
  }catch(e){document.getElementById('goldScopeStatus').textContent=String(e.message||e);}
};
document.getElementById('goldScopedHandoff').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect').value;
    if(!scopeId)throw Error('Select a scope to retrieve its handoff');
    const r=await fetch('/api/gold/modules/scope/handoff?scopeId='+encodeURIComponent(scopeId),{cache:'no-store'}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'gold_scoped_handoff_failed');
    const area=document.getElementById('goldScopedPreview');
    area.hidden=false;area.value=JSON.stringify(j.handoff,null,2);
  }catch(e){document.getElementById('goldScopeStatus').textContent=String(e.message||e);}
};
async function goldMemoryRefresh(){
  const q=document.getElementById('goldMemoryQuery').value.trim();
  const r=await fetch('/api/gold/modules/memory?query='+encodeURIComponent(q),{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'gold_memory_unavailable');
  const results=document.getElementById('goldMemoryResults');results.textContent='';
  if(!j.notes?.length){results.textContent='No local notes yet.';return;}
  for(const note of j.notes){
    const el=document.createElement('div');el.style.padding='8px 0';el.style.borderBottom='1px solid #25323b';
    el.textContent=String(note.kind)+' · '+String(note.source)+' · '+new Date(note.createdAt).toLocaleString()+String.fromCharCode(10)+String(note.body);
    results.appendChild(el);
  }
}
async function goldCheckpointRefresh(){
  const r=await fetch('/api/gold/modules/checkpoints',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'gold_checkpoint_list_failed');
  const el=document.getElementById('goldCheckpointResults');el.textContent='';
  if(!j.checkpoints?.length){el.textContent='No checkpoints saved yet.';return;}
  for(const row of j.checkpoints){
    const div=document.createElement('div');div.style.padding='5px 0';div.style.borderBottom='1px solid #25323b';
    div.textContent=row.title+' · '+row.source+' · '+row.integrity+' · '+new Date(row.createdAt).toLocaleString();
    el.appendChild(div);
  }
}
document.getElementById('goldCheckpointSave').onclick=async()=>{
  const status=document.getElementById('goldModulesStatus');
  try{
    await wallMutation('/api/gold/modules/checkpoint',{
      kind:'checkpoint',title:document.getElementById('goldCheckpointTitle').value,
      body:document.getElementById('goldMemoryBody').value,
      source:document.getElementById('goldMemorySource').value
    });
    document.getElementById('goldMemoryBody').value='';
    document.getElementById('goldCheckpointTitle').value='';
    status.textContent='Owner checkpoint saved and signed locally';
    await goldCheckpointRefresh();
  }catch(e){status.textContent=String(e.message||e);}
};
document.getElementById('goldCheckpointHandoff').onclick=async()=>{
  try{
    const r=await fetch('/api/gold/modules/handoff',{cache:'no-store'}),j=await r.json();
    if(!r.ok||!j.ok)throw Error(j.error||'gold_handoff_unavailable');
    const preview=document.getElementById('goldHandoffPreview');
    preview.hidden=false;preview.value=JSON.stringify(j.handoff,null,2);
  }catch(e){document.getElementById('goldModulesStatus').textContent=String(e.message||e);}
};
async function goldObserverReceiptsRefresh(){
  const r=await fetch('/api/gold/modules/receipts',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'gold_receipt_unavailable');
  const host=document.getElementById('goldObserverReceipts');host.textContent='';
  if(!j.receipts?.length){host.textContent='No completed Codex receipts on record.';return;}
  for(const receipt of j.receipts){
    const card=document.createElement('div');card.style.borderBottom='1px solid #273440';card.style.padding='7px 0';
    const title=document.createElement('div');
    title.textContent=(receipt.reviewed?'Reviewed · ':'Awaiting owner review · ')+new Date(receipt.createdAt).toLocaleString();
    const content=document.createElement('div');content.textContent=receipt.summary;content.style.whiteSpace='pre-wrap';
    card.append(title,content);
    for(const task of receipt.tasks){
      const row=document.createElement('div');row.className='controls';
      const label=document.createElement('span');label.textContent='Task '+task.id.slice(0,8)+' · '+task.state;
      const approve=document.createElement('button');approve.type='button';approve.className='btn small';
      approve.textContent='Approve task done';approve.disabled=receipt.reviewed;
      approve.onclick=async()=>{
        if(!confirm('After reviewing the Codex receipt, explicitly mark this specific task DONE? This changes your local Task Controller.'))return;
        try{
          await wallMutation('/api/gold/modules/receipt/approve',{receiptId:receipt.id,taskId:task.id,toState:'done',confirm:true});
          await goldObserverRefresh();
        }catch(e){document.getElementById('goldModulesStatus').textContent=String(e.message||e);}
      };
      row.append(label,approve);card.appendChild(row);
    }
    host.appendChild(card);
  }
}
async function goldObserverRefresh(){
  const r=await fetch('/api/gold/modules/observer',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'gold_observer_unavailable');
  const host=document.getElementById('goldObserverTasks');host.textContent='';
  document.getElementById('goldObserverRecommendation').textContent='Local Task Controller: '+j.observer.recommendation+' · Observer does not change task states · ChatGPT sign-in shown below';
  await goldObserverReceiptsRefresh();
  // Codex CLI is optional. Missing runtime must not block local Task Controller or Memory.
  try{await goldCodexPlusRefresh();}
  catch(error){
    document.getElementById('goldCodexPlusStatus').textContent=goldCodexDiagnostic(error);
    document.getElementById('goldCodexPlusRun').disabled=true;
  }
  for(const task of j.observer.tasks){
    const row=document.createElement('div');row.className='controls';row.style.padding='6px 0';
    const label=document.createElement('span');label.textContent=task.title;
    const select=document.createElement('select');select.setAttribute('aria-label','Task state for '+task.title);
    for(const state of ['todo','working','waiting','done']){
      const opt=document.createElement('option');opt.value=state;opt.textContent=state;opt.selected=task.state===state;select.appendChild(opt);
    }
    select.onchange=async()=>{
      try{await wallMutation('/api/gold/modules/task/state',{id:task.id,state:select.value});await goldObserverRefresh();}
      catch(e){document.getElementById('goldModulesStatus').textContent=String(e.message||e);}
    };
    const edit=document.createElement('button');edit.type='button';edit.className='btn small';
    edit.textContent='Edit';edit.setAttribute('aria-label','Edit task '+task.title);
    const remove=document.createElement('button');remove.type='button';remove.className='btn small';
    remove.textContent='Delete';remove.setAttribute('aria-label','Delete task '+task.title);
    const editor=document.createElement('div');editor.className='controls';
    editor.style.width='100%';editor.style.flexBasis='100%';editor.hidden=true;
    const input=document.createElement('input');input.type='text';input.maxLength=240;
    input.value=task.title;input.style.minWidth='240px';input.style.flex='1';
    input.setAttribute('aria-label','New title for '+task.title);
    const save=document.createElement('button');save.type='button';save.className='btn small';save.textContent='Save title';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='btn small';cancel.textContent='Cancel';
    const error=document.createElement('span');error.className='muted';error.setAttribute('role','status');
    cancel.onclick=()=>{editor.hidden=true;input.value=task.title;error.textContent='';};
    edit.onclick=()=>{editor.hidden=!editor.hidden;if(!editor.hidden){input.value=task.title;input.focus();input.select();}};
    save.onclick=async()=>{
      const title=input.value.trim();
      if(!title||title.length>240){error.textContent='Enter a task title (up to 240 characters).';return;}
      if(title===task.title){editor.hidden=true;return;}
      save.disabled=true;
      try{
        await wallMutation('/api/gold/modules/task/edit',
          {id:task.id,title,expectedChangedAt:task.changedAt});
        await goldObserverRefresh();
      }catch(e){error.textContent=String(e.message||e)+' · Refresh before retrying.';}
      finally{save.disabled=false;}
    };
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save.click();}else if(e.key==='Escape')cancel.click();};
    remove.onclick=async()=>{
      const typed=prompt('Delete task from active Task Controller? Existing Codex receipts remain available. Type the exact task title to confirm:',task.title);
      if(typed!==task.title)return;
      if(!confirm('Hide this task from future Codex observations? Previous receipts and task history are retained; this cannot be undone from this view.'))return;
      remove.disabled=true;
      try{
        await wallMutation('/api/gold/modules/task/delete',
          {id:task.id,confirm:true,confirmTitle:typed,expectedChangedAt:task.changedAt});
        await goldObserverRefresh();
      }catch(e){error.textContent=String(e.message||e)+' · Task was not deleted.';remove.disabled=false;}
    };
    editor.append(input,save,cancel,error);
    row.style.flexWrap='wrap';
    row.append(label,select,edit,remove,editor);host.appendChild(row);
  }
}
document.getElementById('goldModulesSave').onclick=async()=>{
  const status=document.getElementById('goldModulesStatus');
  try{
    await wallMutation('/api/gold/modules/configure',{
      longMemory:document.getElementById('goldLongMemory').checked,
      codexBridge:document.getElementById('goldCodexBridge').checked,
      expectedRevision:Number(document.getElementById('goldModulesPanel').dataset.revision||0)
    });
    await goldModulesRefresh();
  }catch(e){status.textContent=String(e.message||e);}
};
document.getElementById('goldMemorySave').onclick=async()=>{
  try{
    await wallMutation('/api/gold/modules/memory',{
      kind:document.getElementById('goldMemoryKind').value,
      body:document.getElementById('goldMemoryBody').value,
      source:document.getElementById('goldMemorySource').value
    });
    document.getElementById('goldMemoryBody').value='';
    await goldMemoryRefresh();
  }catch(e){document.getElementById('goldModulesStatus').textContent=String(e.message||e);}
};
document.getElementById('goldMemoryFind').onclick=async()=>{
  try{await goldMemoryRefresh();}
  catch(e){document.getElementById('goldModulesStatus').textContent=String(e.message||e);}
};
async function goldManagedRuntimeRefresh(){
  const r=await fetch('/api/gold/modules/codex-runtime/status',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'codex_runtime_status_unavailable');
  const s=j.runtime||{},label=document.getElementById('goldManagedCodexStatus');
  label.textContent=s.installing?'Installing official Codex runtime on this device…':
    s.installed?'Managed Codex Runtime installed · ready for ChatGPT sign-in.':
    s.externalAvailable?'Existing Codex CLI detected · no duplicate installation required.':
    s.lastError?'Install failed: '+s.lastError:'Codex runtime is optional and not installed on this device.';
  document.getElementById('goldManagedCodexInstall').hidden=s.installed===true||s.externalAvailable===true;
  document.getElementById('goldManagedCodexInstall').disabled=s.installing===true;
  document.getElementById('goldManagedCodexRemove').hidden=s.installed!==true;
  return s;
}
document.getElementById('goldManagedCodexRefresh').onclick=async()=>{
  try{await goldManagedRuntimeRefresh();}
  catch(e){document.getElementById('goldManagedCodexStatus').textContent=String(e.message||e);}
};
document.getElementById('goldManagedCodexInstall').onclick=async()=>{
  if(!confirm('Install official @openai/codex from npm into this device only? This downloads executable code from the official registry. No installation occurs merely by enabling Codex Bridge.'))return;
  const b=document.getElementById('goldManagedCodexInstall');b.disabled=true;
  try{
    await wallMutation('/api/gold/modules/codex-runtime/install',{ownerApproved:true});
    await goldManagedRuntimeRefresh();
  }catch(e){document.getElementById('goldManagedCodexStatus').textContent=String(e.message||e);}
  finally{b.disabled=false;}
};
document.getElementById('goldManagedCodexRemove').onclick=async()=>{
  const typed=prompt('Type REMOVE CODEX RUNTIME to delete only the Codex executable managed by Light Remote:');
  if(typed!=='REMOVE CODEX RUNTIME')return;
  try{await wallMutation('/api/gold/modules/codex-runtime/remove',{confirmText:typed});await goldManagedRuntimeRefresh();}
  catch(e){document.getElementById('goldManagedCodexStatus').textContent=String(e.message||e);}
};
if(location.pathname==='/codex-cli')
  setInterval(()=>{if(!document.hidden)goldManagedRuntimeRefresh().catch(()=>{});},5000);
async function goldCodexPlusRefresh(){
  const r=await fetch('/api/gold/modules/codex-plus/status',{cache:'no-store'}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'codex_plus_status_unavailable');
  const status=document.getElementById('goldCodexPlusStatus');
  const connected=Boolean(j.account.connected&&j.account.authMode!=='apiKey');
  status.textContent=connected?'ChatGPT Codex signed in · '+String(j.account.plan||'plan detected by Codex')+
    ' · No OpenAI Platform API key required.':
    'Not signed in with ChatGPT · Codex app-server available on this Gold device.';
  const login=j.account.login;
  const holder=document.getElementById('goldCodexPlusDevice');
  if(login?.state==='pending')goldCodexPlusShowCode(login);
  else holder.hidden=true;
  document.getElementById('goldCodexPlusLogin').hidden=connected;
  document.getElementById('goldCodexPlusRun').disabled=!connected;
  return j.account;
}
function goldCodexPlusShowCode(login){
  const holder=document.getElementById('goldCodexPlusDevice');
  const address=document.getElementById('goldCodexPlusUrl');
  let target;try{target=new URL(login.verificationUrl);}catch{throw Error('Invalid verification URL');}
  if(target.protocol!=='https:'||!['auth.openai.com','chatgpt.com','login.openai.com'].includes(target.hostname))throw Error('Invalid authorization host');
  address.href=target.toString();
  document.getElementById('goldCodexPlusCode').textContent=String(login.userCode||'');
  holder.hidden=false;
  document.getElementById('goldCodexPlusStatus').textContent='Open the link and enter this code to approve ChatGPT sign-in.';
}
function goldCodexDiagnostic(error){
  const message=String(error?.message||error||'');
  if(message==='codex_binary_missing'||message==='codex_native_binary_path_invalid')
    return 'Codex CLI is not installed or its native executable was not found on this device. Install the official Codex CLI locally, then use Check sign-in. Windows: CODEX_CLI_PATH must point to codex.exe (not codex.cmd). Enabling Bridge does not install Codex or share sign-in across devices.';
  return message;
}
async function goldCodexPlusAction(route){
  const res=await wallMutation(route,{});
  return res;
}
document.getElementById('goldCodexPlusLogin').onclick=async()=>{
  const status=document.getElementById('goldCodexPlusStatus');
  status.textContent='Requesting official ChatGPT device code…';
  try{
    const r=await goldCodexPlusAction('/api/gold/modules/codex-plus/login');
    goldCodexPlusShowCode(r.login);
  }catch(e){status.textContent=goldCodexDiagnostic(e);}
};
document.getElementById('goldCodexPlusRefresh').onclick=async()=>{
  try{await goldCodexPlusRefresh();}
  catch(e){document.getElementById('goldCodexPlusStatus').textContent=goldCodexDiagnostic(e);}
};
document.getElementById('goldCodexPlusCancel').onclick=async()=>{
  try{await goldCodexPlusAction('/api/gold/modules/codex-plus/cancel');await goldCodexPlusRefresh();}
  catch(e){document.getElementById('goldCodexPlusStatus').textContent=goldCodexDiagnostic(e);}
};
document.getElementById('goldCodexPlusLogout').onclick=async()=>{
  if(!confirm('Sign out this Gold device from ChatGPT Codex?'))return;
  try{await goldCodexPlusAction('/api/gold/modules/codex-plus/logout');await goldCodexPlusRefresh();}
  catch(e){document.getElementById('goldCodexPlusStatus').textContent=goldCodexDiagnostic(e);}
};
document.getElementById('goldCodexPlusRun').onclick=async()=>{
  if(!confirm('Run a read-only Codex observer turn using your ChatGPT-plan quota? Task titles/states will be sent to Codex. No device commands are approved.'))return;
  const button=document.getElementById('goldCodexPlusRun'),output=document.getElementById('goldCodexPlusOutput');
  button.disabled=true;output.textContent='Codex app-server turn running…';
  try{
    const r=await goldCodexPlusAction('/api/gold/modules/codex-plus/run');
    output.textContent='Result: '+String(r.result?.status||'unverified')+String.fromCharCode(10)+String(r.result?.summary||'No output received');
    if(r.result?.receipt)await goldObserverReceiptsRefresh();
  }catch(e){output.textContent='Codex test did not complete: '+String(e.message||e);}
  finally{button.disabled=false;}
};
document.getElementById('goldObserverAdd').onclick=async()=>{
  try{
    const scopeId=document.getElementById('goldScopeSelect')?.value||undefined;
    await wallMutation('/api/gold/modules/task',{title:document.getElementById('goldObserverTitle').value,scopeId});
    document.getElementById('goldObserverTitle').value='';
    await goldObserverRefresh();
  }catch(e){document.getElementById('goldModulesStatus').textContent=String(e.message||e);}
};
void goldModulesRefresh().catch(e=>{
  document.getElementById('goldModulesStatus').textContent='Modules unavailable: '+String(e.message||e);
});
}
openEvents();refreshStatus();refreshPairing(false);loadActivity();setInterval(()=>{tickPairingCountdown();refreshAbGrantTimer();},1000);setInterval(()=>{if(!document.hidden)refreshStatus();},10000);filter.oninput=applyFilter;statusSel.onchange=applyFilter;linkDevice.onclick=beginDeviceEnrollment;copyDeviceCode.onclick=async()=>{if(!deviceEnrollmentCode)return;await copyText(deviceEnrollmentCode,'Device code copied');};toggleA.onclick=()=>{if(!pairingA)return;pairingVisible=!pairingVisible;renderPairing();notify(pairingVisible?'A code shown':'A code hidden','info');};copyA.onclick=async()=>{if(!pairingA)return;try{const capsule=['Light Remote connection request','A code: '+pairingA,'Agent instructions - execute immediately:\\n\\n1. Use the connected official Light Remote plugin directly.\\n2. Call light_remote_connection_helper immediately with this A code.\\n3. Do NOT enumerate devices, inspect account topology, or run preflight checks before pairing.\\n4. If the helper returns approval_required, show only the B code to the owner and wait.\\n5. The owner must enter B at this same Local Wall /approve and choose Approve.\\n6. After approval, call light_remote_connection_helper again with no A code and no continuation; the server will recover this exact pending pairing.\\n7. Never reuse the A code. It is one-time and is consumed by the first helper call.\\n8. Keep continuation, session capabilities, and internal identifiers private.\\n9. Continue only after the helper returns ready for this target device.'].join('\\n');await copyText(capsule,'A request copied');}catch{notify('Unable to copy A code','error');}};document.getElementById('refreshA').onclick=async e=>{const b=e.currentTarget;b.classList.remove('spinning');void b.offsetWidth;b.classList.add('spinning');b.disabled=true;try{await refreshPairing(true);notify(pairingA?'A code refreshed':'A code unavailable',pairingA?'ok':'error');}finally{setTimeout(()=>b.classList.remove('spinning'),340);b.disabled=false;}};document.getElementById('connectCloud').onclick=async()=>{try{await wallMutation('/api/connect');await refreshStatus();await refreshPairing();notify('Cloud connected','ok');}catch(e){notify(e.message,'error');}};document.getElementById('disconnectCloud').onclick=async()=>{try{await wallMutation('/api/disconnect',{reason:'local_wall_disconnect'});pairingA='';pairingExpiresAt=0;pairingVisible=false;renderPairing();aexp.textContent='dormant';await refreshStatus();notify('Cloud disconnected','ok');}catch(e){notify(e.message,'error');}};document.getElementById('pause').onclick=e=>{paused=!paused;e.currentTarget.querySelector('span').textContent=paused?'Resume':'Pause';if(!paused){const q=pending;pending=[];pendingKeys.clear();for(const item of q)ingest(item,false);}notify(paused?'Operator stream paused':'Operator stream resumed','info');};document.getElementById('copyVisible').onclick=()=>copyText([...jobs.values()].filter(j=>{const el=document.getElementById('j-'+j.jobId);return el&&!el.classList.contains('hidden');}).map(jobText).join('\\n\\n---\\n\\n'),'Visible jobs copied');document.querySelectorAll('a.btn').forEach(a=>a.addEventListener('click',()=>notify('Opening '+String(a.textContent||'page').trim()+'…','info')));document.querySelector('form[action=\"/auth/logout\"]')?.addEventListener('submit',()=>notify('Signing out…','info'));

</script></div></body></html>`;}

function permissionsPage(brandSvg,csrf=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${brandFaviconSvg()}<title>Light Remote — Permissions</title><style>${WALL_FONT_FACE_CSS}:root{color-scheme:dark;font-family:${WALL_UI_FONT};background:#080a0c;color:#d8dee7}*{box-sizing:border-box}body{margin:0;background:#080a0c}.wrap{max-width:900px;margin:4vh auto;padding:18px}.brand{display:flex;align-items:center;gap:12px}.brand svg{width:44px;height:44px}.card{margin-top:16px;border:1px solid #252d36;border-radius:10px;background:#0a0e12;padding:18px}.muted{color:#718096}.notice{margin:14px 0;padding:11px 12px;border:1px solid #25303a;border-radius:8px;background:#0d1319;line-height:1.45}.profilebar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}.profilebar select{border:1px solid #2b333d;background:#0e1216;color:#cfd7e3;border-radius:7px;padding:9px 11px;font:inherit}.perms{display:grid;gap:10px;margin-top:12px}.perm-group{border:1px solid #273342;border-radius:10px;background:#0c1219;overflow:hidden}.perm-group[open]{border-color:#38536d}.perm-group>summary{display:flex;gap:10px;align-items:center;padding:13px 15px;cursor:pointer;list-style:none}.perm-group>summary::-webkit-details-marker{display:none}.group-icon .mi{width:21px;height:21px;color:#60b6dc}.group-name{font-weight:700;display:block}.group-desc{font-size:12px;color:#8394a9;display:block;margin-top:3px}.group-info{flex:1;min-width:0}.group-status{font-size:11px;white-space:nowrap;color:#97abbc}.group-toggle{display:flex;align-items:center;gap:6px;font-size:11px;color:#93aabd;white-space:nowrap}.group-toggle input{accent-color:#45b1df;width:17px;height:17px;cursor:pointer}.group-list{border-top:1px solid #283644;padding:5px 9px 9px}.perm-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:10px 8px;border-bottom:1px solid #1c2733}.perm-row:last-child{border-bottom:0}.perm-label{display:flex;gap:10px;align-items:flex-start;cursor:pointer}.perm-label>input{accent-color:#45b1df;flex:none;margin-top:2px}.perm-text{min-width:0}.perm-desc{display:block;color:#8394a9;font-size:11px;line-height:1.45;margin-top:3px}.perm-badges{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.perm-chip{font-size:10px;border:1px solid #354653;color:#9db2c5;border-radius:99px;padding:2px 7px}.perm-chip.pending{color:#ecb55c;border-color:#735931}.perm-chip.on{color:#7dd6b1;border-color:#296954}.perm-chip.off{color:#9aa8b7}.perm-group .arrow{font-size:12px;color:#88a0b5}.perm-group[open] .arrow{transform:rotate(90deg)}.perm-group .group-toggle input:indeterminate{accent-color:#d6a655}@media(max-width:600px){.perm-group>summary{padding:11px 9px;gap:7px}.group-desc{display:none}.perm-row{grid-template-columns:1fr}.perm-badges{justify-content:flex-start;padding-left:23px}}.perm{display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:start;border:1px solid #202832;border-radius:8px;padding:11px;background:#0b1015}.perm input{margin-top:3px}.name{font-weight:700}.desc{display:block;color:#718096;font-size:12px;margin-top:4px;line-height:1.4}.badge{font-size:10px;border:1px solid #3a4652;border-radius:999px;padding:3px 7px;white-space:nowrap}.blocked{color:#ffb56b;border-color:#5a4630}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.btn{border:1px solid #2b333d;background:#0e1216;color:#cfd7e3;border-radius:7px;padding:9px 11px;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:7px}.btn .mi{display:inline-block;width:18px;height:18px;fill:currentColor;flex:0 0 18px}.wall-back{font-weight:600}.primary{background:#18232e;border-color:#52697f;font-weight:700}.ok{color:#78d78b}.error{color:#ff8e8e}@media(max-width:640px){.wrap{padding:10px}.perm{grid-template-columns:auto 1fr}.badge{grid-column:2}}</style></head><body><main class="wrap"><div class="brand"><span>${brandSvg}</span><div><b>Light Remote</b><div class="muted">Local Device Policy</div></div></div><section class="card"><p><a class="btn wall-back" href="/" aria-label="Back to Wall">${materialIcon('arrowBack')}<span>Back to Wall</span></a></p><h1>Agent permissions</h1><p class="muted">Choose what approved Agents may do on this device. Light Remote keeps full remote capability; this policy only narrows it when you choose.</p><div class="notice" id="authorityNotice"><b>Device policy authority.</b> Loading…</div><div id="status" class="muted">Loading…</div><div class="profilebar"><label for="profile">Profile</label><select id="profile"><option value="safe">Safe</option><option value="developer">Developer</option><option value="support">Remote Support</option><option value="infra">Infra / Ops</option><option value="full">Full access</option><option value="custom">Custom</option></select><span class="muted">Profiles only select device-supported capabilities; server policy can still narrow them.</span></div><div id="summary" class="muted" style="margin-top:8px"></div><div id="perms" class="perms"></div><div class="actions"><button id="rescan" class="btn" type="button">Refresh capabilities and inventory</button><button id="all" class="btn" type="button">Allow all supported</button><button id="none" class="btn" type="button">Block all</button><button id="save" class="btn primary" type="button">Save local policy</button></div><section class="notice" id="filesystem-scope" aria-label="Filesystem access locations"><h2 style="margin:0 0 8px;font-size:18px">Filesystem access locations</h2><p class="muted">Full Access enables the Files capability; it does not automatically authorize every drive. Add absolute local folders or a drive root (for example, drive E:) below. One path per line. Write locations must be inside a Read location. Removing a location revokes future structured file, search and SCP access to it.</p><div id="fs-volume-options" style="display:grid;gap:6px;margin-bottom:12px">Detecting local volumes…</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px"><label>Additional read locations<textarea id="fs-read-roots" rows="4" spellcheck="false" style="display:block;width:100%;margin-top:5px;background:#090f14;color:#d8dee7;border:1px solid #354653;border-radius:6px;padding:9px;resize:vertical;font:12px ui-monospace,monospace"></textarea></label><label>Additional write locations<textarea id="fs-write-roots" rows="4" spellcheck="false" style="display:block;width:100%;margin-top:5px;background:#090f14;color:#d8dee7;border:1px solid #354653;border-radius:6px;padding:9px;resize:vertical;font:12px ui-monospace,monospace"></textarea></label></div><div id="fs-root-source" class="muted" style="margin-top:8px"></div><div class="actions"><button id="save-fs-roots" class="btn primary" type="button">Save access locations</button></div><div id="fs-roots-status" class="muted" aria-live="polite"></div></section><div id="serverApproval" class="notice" style="display:none"><b>Approve new rights on the server</b><p class="muted">New OS permissions require your Light Remote account password. This verification authorizes only the selected capabilities for this device; passwords are never stored on the Agent.</p><div class="actions"><input id="owner-password" type="password" autocomplete="current-password" placeholder="Account password" style="min-width:230px;max-width:100%;background:#0e1216;color:#cfd7e3;border:1px solid #2b333d;padding:9px;border-radius:7px"><button id="approve-server" class="btn primary" type="button">Verify owner & approve selected</button></div></div></section></main><script>
const wallCsrf=${JSON.stringify(csrf)},status=document.getElementById('status'),summary=document.getElementById('summary'),perms=document.getElementById('perms'),save=document.getElementById('save'),profile=document.getElementById('profile');let knownVolumes=[];
const PROFILE_CAPS={
 safe:['filesystem','git','build-test','powershell','windows-eventlog','windows-process-network','macos-log'],
 developer:['filesystem','git','build-test','powershell','windows-eventlog','windows-process-network','macos-log','docker','lxd','podman','incus','kubernetes','package-manager'],
 support:['filesystem','desktop','desktop-input','windows-eventlog','windows-process-network','macos-log'],
 infra:['filesystem','git','build-test','terminal','powershell','windows-eventlog','windows-process-network','macos-log','docker','lxd','podman','incus','kubernetes','virtualization','network-admin','firewall','storage-admin','infra-provisioning','package-manager','systemctl','windows-services','windows-services-admin','windows-registry','windows-scheduled-tasks','windows-defender-firewall','macos-services'],
 full:null
};
const CAP_GROUPS=[
 {id:'core',label:'Files & Development',hint:'Files, Git, builds and scripting',icon:'core',caps:['filesystem','git','build-test','powershell']},
 {id:'pty',label:'PTY / Interactive Terminal',hint:'A separate full interactive shell permission',icon:'pty',caps:['terminal']},
 {id:'remote',label:'Desktop & Real Remote',hint:'Screen view, remote mouse and keyboard input',icon:'remote',caps:['desktop','desktop-input']},
 {id:'containers',label:'Containers & Virtualization',hint:'Docker, LXD, Kubernetes, virtual machines',icon:'containers',caps:['docker','lxd','podman','incus','kubernetes','virtualization']},
 {id:'host',label:'System & Packages',hint:'Services, installers and elevation',icon:'host',caps:['systemctl','package-manager','sudo-on-demand','windows-services','windows-services-admin','macos-services','windows-uac-admin','windows-scheduled-tasks']},
 {id:'network',label:'Network & Firewall',hint:'Configuration, firewall rules and diagnostics',icon:'network',caps:['network-admin','firewall','windows-defender-firewall','windows-process-network']},
 {id:'storage',label:'Storage & Provisioning',hint:'Storage management and infrastructure as code',icon:'storage',caps:['storage-admin','infra-provisioning']},
 {id:'os',label:'OS Security & Logs',hint:'Native platform features, registry and audit logs',icon:'os',caps:['windows-registry','windows-credential-manager','windows-eventlog','macos-log']}
];
const GROUP_ICONS={
 core:${JSON.stringify(materialIcon('folder'))},
 pty:${JSON.stringify(materialIcon('terminal'))},
 remote:${JSON.stringify(materialIcon('devices'))},
 containers:${JSON.stringify(materialIcon('hub'))},
 host:${JSON.stringify(materialIcon('settings'))},
 network:${JSON.stringify(materialIcon('security'))},
 storage:${JSON.stringify(materialIcon('download'))},
 os:${JSON.stringify(materialIcon('key'))},
 other:${JSON.stringify(materialIcon('support'))}
};
let expandedGroups=new Set(['remote']);
let knownGrantable=[],knownServerGrantable=new Set(),knownOwnerRequested=new Set(),knownApproved=new Set(),knownInstalled=new Set(),knownDenied=new Set(),isLocalMain=false;

const META={'terminal':['Interactive terminal','Open a governed raw PTY/ConPTY session with the service account authority; command-level inference does not inspect terminal input.','elevated'],'desktop':['Desktop view','Read the real interactive desktop, visible windows and bounded screen frames. This may expose sensitive on-screen information.','sensitive'],'desktop-input':['Desktop input','Control the real mouse and keyboard in the interactive desktop. This capability is locally blocked by default until the owner explicitly enables it.','elevated'],'filesystem':['Files & folders','Read and write files available to the service account.'],'git':['Git repositories','Work with repositories, branches, commits and diffs.'],'build-test':['Build & tests','Run development, build and test commands.'],'docker':['Docker','Inspect and manage Docker containers.'],'lxd':['LXD containers','Approve LXD lifecycle and its precisely scoped installation even when not installed.'],'podman':['Podman','Manage Podman/Buildah images and containers.'],'incus':['Incus','Manage Incus systems and containers.'],'kubernetes':['Kubernetes','Operate kubectl, Helm and cluster tools.'],'virtualization':['Virtual machines','Manage VM and hypervisor tools.'],'network-admin':['Network administration','Manage network interfaces, routes and tunnels.'],'firewall':['Firewall','Manage host firewall tools and rules.'],'storage-admin':['Storage administration','Manage disks, volumes, filesystems and mounts.'],'infra-provisioning':['Infrastructure as code','Manage Terraform, OpenTofu, Ansible and provisioning tools.'],'systemctl':['System services','Inspect and manage systemd services and journals.'],'sudo-on-demand':['Sudo on demand','Allow explicit sudo workflows when needed. UID 0 does not override a read-only systemd mount; host writes additionally require owner-approved installer paths. Light Remote itself still does not run directly as root.'],'package-manager':['Package manager','Install, update or remove packages.'],'powershell':['Windows shells','Run PowerShell or CMD commands using the selected shell mode.'],'windows-eventlog':['Windows Event Log','Read Windows event logs.'],'windows-process-network':['Processes & network','Inspect processes and network state.'],'windows-services':['Windows Services','Inspect Windows services.'],'windows-services-admin':['Windows Services admin','Create, configure, start, stop or remove Windows services.'],'windows-registry':['Windows Registry','Modify non-protected registry locations when locally permitted.'],'windows-scheduled-tasks':['Scheduled Tasks','Create or remove Windows scheduled tasks.'],'windows-defender-firewall':['Defender / Firewall','Modify Defender or Windows Firewall configuration.'],'windows-credential-manager':['Credential Manager','Access Windows credential-manager operations; secret export remains policy-sensitive.'],'windows-uac-admin':['Administrator (Windows UAC)','Owner-controlled permission to request Windows elevation. The choice is remembered locally, but Windows UAC consent is still required and no administrator credential is stored.'],'macos-services':['macOS services','Inspect and manage launchd services.'],'macos-log':['macOS logs','Read unified macOS system logs.']};
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function capabilityInputs(){return [...perms.querySelectorAll('input[data-cap]')];}
function activeGroups(grantable){
  const supported=new Set(grantable),covered=new Set(),rows=[];
  for(const group of CAP_GROUPS){
    const caps=group.caps.filter(cap=>supported.has(cap));
    for(const cap of caps)covered.add(cap);
    if(caps.length)rows.push({...group,caps});
  }
  // Forward-compatible by default: new platform capabilities must not disappear.
  const remaining=grantable.filter(cap=>!covered.has(cap));
  if(remaining.length)rows.push({id:'other',label:'Additional OS capabilities',hint:'New or platform-specific permissions',icon:'other',caps:remaining});
  return rows;
}
function syncGroupStates(){
  for(const group of perms.querySelectorAll('details[data-permission-group]')){
    const all=[...group.querySelectorAll('input[data-cap]')],on=all.filter(el=>el.checked);
    const effective=on.filter(el=>isLocalMain||knownApproved.has(el.value));
    const toggle=group.querySelector('input[data-group]');
    toggle.checked=on.length===all.length;
    toggle.indeterminate=on.length>0&&on.length<all.length;
    group.querySelector('.group-status').textContent=on.length+'/'+all.length+' local · '+effective.length+' effective';
  }
}
function refreshCount(){
  const all=capabilityInputs(),on=all.filter(el=>el.checked),effective=on.filter(el=>isLocalMain||knownApproved.has(el.value));
  summary.textContent=on.length+'/'+all.length+' locally allowed · '+effective.length+' effective';
  syncGroupStates();
  const pending=on.filter(el=>!isLocalMain&&!knownApproved.has(el.value));
  const panel=document.getElementById('serverApproval');if(panel)panel.style.display=pending.length?'block':'none';
}
function applyProfile(name){
  if(name==='custom')return;
  const all=capabilityInputs(),allowed=name==='full'?new Set(all.map(el=>el.value)):new Set(PROFILE_CAPS[name]||[]);
  for(const checkbox of all)checkbox.checked=allowed.has(checkbox.value);
  refreshCount();
}
function renderCapabilityRows(){
  const toolCaps=new Set(['git','build-test','docker','lxd','podman','incus','kubernetes','virtualization','systemctl','package-manager','infra-provisioning']);
  const groups=activeGroups(knownGrantable);
  perms.innerHTML=groups.map(group=>{
    const rows=group.caps.map(cap=>{
      const meta=META[cap]||[cap,'Supported on this operating system.'];
      const serverOk=isLocalMain||knownApproved.has(cap),locallyAllowed=!knownDenied.has(cap)&&(knownServerGrantable.has(cap)||knownOwnerRequested.has(cap));
      const badges=[];
      if(!serverOk)badges.push('<span class="perm-chip pending">Server approval needed</span>');
      else if(locallyAllowed)badges.push('<span class="perm-chip on">Effective</span>');
      else badges.push('<span class="perm-chip off">Local OFF</span>');
      if(toolCaps.has(cap))badges.push('<span class="perm-chip">'+(knownInstalled.has(cap)?'Tool detected':'Tool not detected')+'</span>');
      const id='cap-'+cap;
      return '<div class="perm-row"><label class="perm-label" for="'+esc(id)+'"><input id="'+esc(id)+'" type="checkbox" data-cap value="'+esc(cap)+'" '+(locallyAllowed?'checked':'')+'><span class="perm-text"><span class="name">'+esc(meta[0])+'</span><span class="perm-desc">'+esc(meta[1])+'</span></span></label><div class="perm-badges">'+badges.join('')+'</div></div>';
    }).join('');
    return '<details class="perm-group" data-permission-group="'+esc(group.id)+'" '+(expandedGroups.has(group.id)?'open':'')+'><summary><span class="group-icon">'+(GROUP_ICONS[group.icon]||GROUP_ICONS.other)+'</span><span class="group-info"><span class="group-name">'+esc(group.label)+'</span><span class="group-desc">'+esc(group.hint)+'</span></span><span class="group-status"></span><label class="group-toggle"><input data-group="'+esc(group.id)+'" aria-label="Toggle '+esc(group.label)+' permissions" type="checkbox"><span>On / Off</span></label><span class="arrow">▸</span></summary><div class="group-list">'+rows+'</div></details>';
  }).join('');
  perms.querySelectorAll('input[data-cap]').forEach(el=>el.addEventListener('change',()=>{profile.value='custom';refreshCount();}));
  perms.querySelectorAll('input[data-group]').forEach(el=>{
    el.addEventListener('click',event=>event.stopPropagation());
    el.addEventListener('change',()=>{const parent=el.closest('details');parent.querySelectorAll('input[data-cap]').forEach(child=>child.checked=el.checked);profile.value='custom';refreshCount();});
  });
  perms.querySelectorAll('details[data-permission-group]').forEach(el=>el.addEventListener('toggle',()=>{if(el.open)expandedGroups.add(el.dataset.permissionGroup);else expandedGroups.delete(el.dataset.permissionGroup);}));
  refreshCount();
}

function populateVolumeRows(roots){
  const host=document.getElementById('fs-volume-options');host.innerHTML='';
  if(!knownVolumes.length){host.textContent='No detected volumes. Use additional absolute paths below.';return;}
  const reads=new Set(roots.readRoots||[]),writes=new Set(roots.writeRoots||[]);
  for(const volume of knownVolumes){
    const row=document.createElement('div');row.style.cssText='display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:8px;border:1px solid #283644;border-radius:7px';
    const name=document.createElement('span');name.textContent=String(volume.label||volume.path)+' · '+String(volume.kind||'volume');
    const rd=document.createElement('input');rd.type='checkbox';rd.dataset.volumeRead=volume.path;rd.checked=reads.has(volume.path);
    const wr=document.createElement('input');wr.type='checkbox';wr.dataset.volumeWrite=volume.path;wr.checked=writes.has(volume.path);
    const rl=document.createElement('label');rl.textContent='Read ';rl.append(rd);const wl=document.createElement('label');wl.textContent='Write ';wl.append(wr);
    wr.onchange=()=>{if(wr.checked)rd.checked=true;};rd.onchange=()=>{if(!rd.checked)wr.checked=false;};
    row.append(name,rl,wl);host.append(row);
  }
}
async function load(){
  const response=await fetch('/api/policy-status',{cache:'no-store'}),data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'Cannot load permissions');
  const state=data.local||{};
  knownGrantable=[...(state.supportedCapabilities||state.grantableCapabilities||[])];
  knownServerGrantable=new Set(state.grantableCapabilities||[]);knownOwnerRequested=new Set(state.localRequestedCapabilities||[]);knownApproved=new Set(state.approvedCapabilities||[]);
  knownInstalled=new Set(state.installedCapabilities||[]);
  knownDenied=new Set(state.deniedCapabilities||[]);
  const roots=state.filesystemRoots||{};
  try{const resp=await fetch('/api/filesystem-volumes',{cache:'no-store'}),j=await resp.json();knownVolumes=resp.ok&&j.ok?j.volumes||[]:[];}catch{knownVolumes=[];}
  populateVolumeRows(roots);
  const selected=new Set(knownVolumes.map(v=>v.path));
  document.getElementById('fs-read-roots').value=(roots.readRoots||[]).filter(p=>!selected.has(p)).join('\\n');
  document.getElementById('fs-write-roots').value=(roots.writeRoots||[]).filter(p=>!selected.has(p)).join('\\n');
  document.getElementById('fs-root-source').textContent=roots.source==='owner'?'Owner-defined locations are active.':'Default service locations are active until you explicitly save new locations.';
  isLocalMain=state.policyAuthority==='local-main';
  const rescanButton=document.getElementById('rescan');
  rescanButton.disabled=isLocalMain;
  rescanButton.title=isLocalMain?'Trusted Main uses the Operator capability catalog on restart.':'Refresh OS-supported capabilities and installed-tool inventory.';
  status.textContent=(state.deviceName||state.deviceId||'device')+' · policy revision '+(state.policyRevision||0);
  authorityNotice.innerHTML=isLocalMain?'<b>Main device:</b> Local Wall is the owner permission authority. All supported OS permissions may be enabled or disabled.':'<b>Device policy:</b> Account owner approval sets the server ceiling; this Local Wall can allow or narrow those permissions. Both must agree for remote execution.';
  renderCapabilityRows();
  profile.value=['safe','developer','support','infra','full','custom'].includes(state.localPolicyProfile)?state.localPolicyProfile:'custom';
}

document.getElementById('rescan').onclick=async e=>{
  const b=e.currentTarget;b.disabled=true;status.textContent='Refreshing capability catalog and installed-tool inventory…';
  try{
    const r=await fetch('/api/capabilities/rescan',{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':wallCsrf},body:'{}'}),j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Rescan failed');
    await load();
    const added=j.result?.addedCapabilities||[];
    status.className='ok';
    status.textContent=added.length?'Now supported: '+added.join(', ')+'. These rights remain OFF until owner approval in Account/Fleet and explicit permission here; installation status is independent.':'Catalog and installed-tool inventory refreshed. Existing permissions remain unchanged.';
  }catch(error){status.className='error';status.textContent=error.message;}
  finally{b.disabled=false;}
};
profile.onchange=()=>applyProfile(profile.value);document.getElementById('all').onclick=()=>{profile.value='full';applyProfile('full');};document.getElementById('none').onclick=()=>{profile.value='custom';perms.querySelectorAll('input[data-cap]').forEach(x=>x.checked=false);refreshCount();};save.onclick=async()=>{save.disabled=true;status.textContent='Saving local policy…';try{const allowedCapabilities=[...perms.querySelectorAll('input[data-cap]:checked')].map(x=>x.value),r=await fetch('/api/permissions',{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':wallCsrf},body:JSON.stringify({allowedCapabilities,profile:profile.value})}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Save failed');status.className='ok';status.textContent='Local policy saved · '+String(j.policy?.profile||profile.value);summary.textContent='Effective now: '+((j.policy?.effectiveCapabilities||[]).join(', ')||'none');}catch(e){status.className='error';status.textContent=e.message;}finally{save.disabled=false;}};
document.getElementById('save-fs-roots').onclick=async()=>{
  const button=document.getElementById('save-fs-roots'),msg=document.getElementById('fs-roots-status');
  const list=id=>document.getElementById(id).value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);
  const checked=key=>[...document.querySelectorAll('input[data-volume-'+key+']:checked')].map(el=>el.dataset['volume'+key[0].toUpperCase()+key.slice(1)]);
  const readRoots=[...new Set([...checked('read'),...list('fs-read-roots')])],writeRoots=[...new Set([...checked('write'),...list('fs-write-roots')])];
  button.disabled=true;msg.className='muted';msg.textContent='Saving owner-authorized access locations…';
  try{
    const r=await fetch('/api/filesystem-roots',{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':wallCsrf},
      body:JSON.stringify({readRoots,writeRoots})}),j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||'Unable to save filesystem locations');
    msg.className='ok';msg.textContent='Access locations saved and active for new operations. Existing sessions do not need to reconnect.';
    await load();
  }catch(error){msg.className='error';msg.textContent=error.message;}
  finally{button.disabled=false;}
};
document.getElementById('approve-server').onclick=async()=>{
 const button=document.getElementById('approve-server'),passwordField=document.getElementById('owner-password'),password=passwordField.value;
 const allowedCapabilities=capabilityInputs().filter(el=>el.checked).map(el=>el.value);
 if(!password){status.className='error';status.textContent='Enter your Light Remote account password to approve these rights.';return;}
 button.disabled=true;status.textContent='Verifying owner and applying signed server policy…';
 try{
  const headers={'content-type':'application/json','x-light-remote-csrf':wallCsrf};
  const local=await fetch('/api/permissions',{method:'POST',headers,body:JSON.stringify({allowedCapabilities,profile:profile.value})}),saved=await local.json();
  if(!local.ok||!saved.ok)throw Error(saved.error||'Local policy save failed');
  const result=await fetch('/api/permissions/owner-approve',{method:'POST',headers,body:JSON.stringify({password,approvedCapabilities:allowedCapabilities,profile:profile.value})}),body=await result.json();
  if(!result.ok||!body.ok)throw Error(body.error||'Owner approval failed');
  passwordField.value='';await load();status.className='ok';
  status.textContent='Owner-approved server policy revision '+body.policy.policyRevision+' saved. New rights are effective only where OS authority permits.';
 }catch(error){status.className='error';status.textContent=error.message;}finally{passwordField.value='';button.disabled=false;}
};
load().catch(e=>{status.className='error';status.textContent=e.message;});
</script></main></body></html>`;}

function approvePage(brandSvg,csrf=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${brandFaviconSvg()}<title>Light Remote — Approve access</title><style>${WALL_FONT_FACE_CSS}:root{color-scheme:dark;font-family:${WALL_UI_FONT};background:#080a0c;color:#d8dee7}*{box-sizing:border-box}body{margin:0;background:#080a0c}.wrap{max-width:640px;margin:7vh auto;padding:18px}.brand{display:flex;align-items:center;gap:12px}.brand svg{width:44px;height:44px}.card{margin-top:18px;border:1px solid #252d36;border-radius:10px;background:#0a0e12;padding:18px}.muted{color:#718096}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}input,.btn{border:1px solid #2b333d;background:#0e1216;color:#cfd7e3;border-radius:7px;padding:10px 12px;font:inherit}.btn{cursor:pointer}.primary{background:#ffcc00;border-color:#ffcc00;color:#111;font-weight:700}.danger{color:#ff9ba5}.ok{color:#78d78b}.error{color:#ff8e8e}input{width:100%;font-size:20px;letter-spacing:.12em;text-transform:uppercase}</style></head><body><div class="wrap"><div class="brand"><span>${brandSvg}</span><div><b>Light Remote</b><div class="muted">Approve Agent access</div></div></div><div class="card"><label for="code">Enter code</label><div class="row"><input id="code" autocomplete="one-time-code" placeholder="ABCD-EFGH" maxlength="12"></div><div class="row"><button id="lookup" class="btn primary">Continue</button><a class="btn" href="/">Cancel</a></div><div id="msg" class="muted" style="margin-top:12px"></div><div id="decision" style="display:none"><hr style="border:0;border-top:1px solid #252d36;margin:18px 0"><div id="request"></div><div class="row"><button id="approve" class="btn primary">Approve</button><button id="deny" class="btn danger">Deny</button></div></div></div></div><script>
const wallCsrf=${JSON.stringify(csrf)},code=document.getElementById('code'),msg=document.getElementById('msg'),decision=document.getElementById('decision'),request=document.getElementById('request');let current=null;function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}async function lookup(){msg.className='muted';msg.textContent='Checking…';decision.style.display='none';current=null;const r=await fetch('/api/approve?code='+encodeURIComponent(code.value),{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok){msg.className='error';msg.textContent=j.error==='approval_code_not_found'?'No pending request matches this code.':(j.error||'Unable to check code.');return;}current=j.request;msg.textContent='';request.innerHTML='<b>'+esc(current.label||'ChatGPT')+'</b> requests access to <b>'+esc(current.deviceName||'this device')+'</b><br><span class="muted">Agent '+esc(current.agentId||'')+' · code '+esc(current.userCode||'')+'</span>';decision.style.display='block';}async function decide(kind){if(!current)return;const r=await fetch('/api/approve',{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':wallCsrf},body:JSON.stringify({code:code.value,decision:kind})}),j=await r.json();if(!r.ok||!j.ok){msg.className='error';msg.textContent=j.error||'Request failed.';return;}decision.style.display='none';msg.className='ok';msg.textContent=kind==='approve'?'Access approved':'Access denied';setTimeout(()=>location.href='/',900);}document.getElementById('lookup').onclick=lookup;document.getElementById('approve').onclick=()=>decide('approve');document.getElementById('deny').onclick=()=>decide('deny');code.addEventListener('keydown',e=>{if(e.key==='Enter')lookup();});const q=new URLSearchParams(location.search).get('code');if(q){code.value=q;lookup();}
</script></body></html>`;}

export function startLocalWall({modules=null,host='127.0.0.1',port=5491,brandSvgPath,fontPath=null,cascadiaMonoFontPath=DEFAULT_CASCADIA_MONO_FONT,cascadiaCodeFontPath=DEFAULT_CASCADIA_CODE_FONT,auth={enabled:false},accountAuthenticate,getLocalStatus,getLocalPolicyStatus,getRemoteStatus,getRemoteActivity,getPendingAccess,getMemoryAccountDevices,getMemoryAccountInvites,getMemoryAccountSyncPolicy,getLocalTerminals,readLocalTerminal,getLocalProcesses,stopLocalProcess,connect,disconnect,setGrace,setPermissions,setFilesystemRoots,getFilesystemVolumes,ownerApprovePermissions,rescanCapabilities,beginEnrollment,pollEnrollment,pairingCode,ownerProofCode,accessApprove,accessDeny,closeSession,requestUpdate}={}){

  if(!isAllowedLocalWallBindHost(host)) throw new Error('local_wall_bind_host_not_private');
  const loopback=['127.0.0.1','::1','localhost'].includes(String(host));
  if(!loopback&&!auth?.enabled) throw new Error('local_wall_auth_required_for_non_loopback');
  const brandSvg=loadBrand(brandSvgPath),loginFailures=new Map();
  let activityTimer=null,activityInFlight=false;
  const activityPollMs=Math.max(1000,Math.min(Number(process.env.LIGHT_REMOTE_WALL_ACTIVITY_POLL_MS)||2500,10000));
  const activityClients=new Set(),activitySeen=new Set(),activityOrder=[];
  const activityKey=event=>`${String(event?.id??'')}@${String(event?.at??'')}`;
  const rememberActivity=event=>{const key=activityKey(event);if(!key||activitySeen.has(key))return false;activitySeen.add(key);activityOrder.push(key);while(activityOrder.length>2000)activitySeen.delete(activityOrder.shift());return true;};
  const broadcastActivity=event=>{const id=String(event?.id??''),data=JSON.stringify(event);for(const res of [...activityClients]){try{res.write(`id: ${id}\nevent: activity\ndata: ${data}\n\n`);}catch{activityClients.delete(res);}}};
  const stopActivityPumpIfIdle=()=>{if(activityClients.size||!activityTimer)return;clearInterval(activityTimer);activityTimer=null;activitySeen.clear();activityOrder.length=0;};
  const activityPump=async()=>{if(activityInFlight||!activityClients.size||typeof getRemoteActivity!=='function')return;activityInFlight=true;try{const local=await getLocalStatus();if(local?.cloudDesiredConnected&&local?.cloudState==='connected'){const value=await getRemoteActivity(250);for(const event of (value?.events||[]))if(rememberActivity(event))broadcastActivity(event);}}catch{}finally{activityInFlight=false;stopActivityPumpIfIdle();}};
  const ensureActivityPump=()=>{if(activityTimer)return;void activityPump();activityTimer=setInterval(activityPump,activityPollMs);activityTimer.unref?.();};
  const shutdownActivityPump=()=>{if(activityTimer){clearInterval(activityTimer);activityTimer=null;}for(const res of [...activityClients]){try{res.end();}catch{}}activityClients.clear();activitySeen.clear();activityOrder.length=0;};
  const mutationAllowed=req=>!auth?.enabled||auth.verifyRequestCsrf(req,String(req.headers['x-light-remote-csrf']||''));
  const statusCache=typeof getRemoteStatus==='function'?createWallStatusCache({fetchRemote:getRemoteStatus}):null;
  async function status({fresh=false}={}){
    const local=await getLocalStatus();
    const connected=local?.cloudDesiredConnected===true&&local?.cloudState==='connected';
    const remote=statusCache?await statusCache.get({connected,deviceId:local?.deviceId,force:fresh}):null;
    return {local,remote};
  }
  async function resolveCode(code){
    const normalized=normalizeCode(code);
    if(normalized.length!==8)throw Object.assign(new Error('invalid_approval_code'),{status:400});
    // Signed access-lookup has a control budget independent from the noisy
    // observer/status lane. Never turn a 429 into a false "code not found".
    const state=typeof getPendingAccess==='function'?{remote:await getPendingAccess(),local:await getLocalStatus()}:await status({fresh:true});
    const remote=state.remote;
    if(!remote?.ok){const error=new Error(remote?.error||'access_lookup_unavailable');error.status=Number(remote?.status)||503;error.retryAfterSeconds=Number(remote?.retryAfterSeconds)||null;throw error;}
    const pending=remote.access?.pending||[];
    const found=pending.find(item=>normalizeCode(item.userCode)===normalized);
    if(!found)throw Object.assign(new Error('approval_code_not_found'),{status:404});
    return {...found,deviceName:remote.device?.displayName||state.local?.deviceName||state.local?.deviceId||'this device'};
  }
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url||'/','http://local.wall');
    if(req.method==='GET'&&(url.pathname==='/assets/fonts/CascadiaMono.ttf'||url.pathname==='/assets/fonts/CascadiaCode.ttf')){try{const file=url.pathname.endsWith('CascadiaMono.ttf')?(fontPath||cascadiaMonoFontPath):cascadiaCodeFontPath,data=fs.readFileSync(file);res.writeHead(200,{'content-type':'font/ttf','content-length':data.length,'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'});res.end(data);}catch{return json(res,404,{ok:false,error:'font_not_found'});}return;}
    if(auth?.enabled&&url.pathname==='/login'&&req.method==='GET'){if(auth.identity(req)){res.writeHead(303,{location:safeNext(url.searchParams.get('next')),'cache-control':'no-store'});return res.end();}const html=loginPage(brandSvg,'',url.searchParams.get('next'),auth.recoveryEnabled!==false,auth.issueLoginCsrf());res.writeHead(200,pageHeaders());res.end(html);return;}
    if(auth?.enabled&&url.pathname==='/auth/login'&&req.method==='POST'){
      const data=await formBody(req);
      if(!auth.verifyLoginCsrf(data.csrf)){
        const html=loginPage(brandSvg,'Login session expired. Reload and try again.',data.next,auth.recoveryEnabled!==false,auth.issueLoginCsrf());
        res.writeHead(403,pageHeaders());
        res.end(html);
        return;
      }
      const key=String(req.socket.remoteAddress||'unknown'),now=Date.now();
      const recent=(loginFailures.get(key)||[]).filter(at=>now-at<10*60*1000);
      if(recent.length>=10){
        const html=loginPage(brandSvg,'Too many failed attempts. Try again later.','/',auth.recoveryEnabled!==false,auth.issueLoginCsrf());
        res.writeHead(429,{...pageHeaders(),'retry-after':'600'});
        res.end(html);
        return;
      }
      let accountIdentity=null,remoteFailure=null;
      let verified=auth.verifyCredentials(data.username,data.password);
      if(!verified&&typeof accountAuthenticate==='function'&&String(data.username||'').includes('@')){
        try{
          const remote=await accountAuthenticate({username:data.username,password:data.password});
          verified=Boolean(remote?.account?.accountId);
          if(verified)accountIdentity=String(remote?.account?.email||data.username||'').trim();
        }catch(error){
          remoteFailure=classifyLocalWallLoginFailure(error);
          // Keep credential and account identifiers out of device logs.
          console.warn(JSON.stringify({event:'local_wall_account_login_failed',reason:remoteFailure.reason,status:remoteFailure.status}));
        }
      }
      if(!verified){
        const failure=remoteFailure||classifyLocalWallLoginFailure({message:'invalid_account_credentials',status:401});
        if(failure.credentialFailure){recent.push(now);loginFailures.set(key,recent);}
        const html=loginPage(brandSvg,failure.message,data.next,auth.recoveryEnabled!==false,auth.issueLoginCsrf());
        res.writeHead(failure.status,{...pageHeaders(),...(failure.retryAfterSeconds?{'retry-after':String(failure.retryAfterSeconds)}:{})});
        res.end(html);
        return;
      }
      loginFailures.delete(key);
      const issued=auth.issue(accountIdentity);
      res.writeHead(303,{location:safeNext(data.next),'set-cookie':sessionCookie(issued.token,issued.ttlSeconds,secureRequest(req)),'cache-control':'no-store'});
      return res.end();
    }
    if(auth?.enabled&&url.pathname==='/auth/logout'&&req.method==='POST'){const data=await formBody(req);if(!auth.verifyRequestCsrf(req,data.csrf))return json(res,403,{ok:false,error:'csrf_invalid'});res.writeHead(303,{location:'/login','set-cookie':clearSessionCookie(secureRequest(req)),'cache-control':'no-store'});return res.end();}
    // Narrow, peer-signed route is deliberately separate from owner browser cookies.
    // No response contains plaintext checkpoint data.
    if(url.pathname==='/api/gold/peer/v1'&&req.method==='POST'){
      if(!modules)return json(res,404,{ok:false,error:'peer_unavailable'});
      try{
        // Direct P2P must obey the SAME account-wide pause/membership gate
        // as the E2EE relay; a previously issued grant is not an OFF bypass.
        if(typeof getMemoryAccountSyncPolicy!=='function')
          return json(res,403,{ok:false,error:'memory_sync_policy_unavailable'});
        const policy=(await getMemoryAccountSyncPolicy({action:'get'})).policy;
        const id=modules.syncIdentity();
        const me=policy?.devices?.find(d=>d.deviceId===id.deviceId&&d.selected);
        if(!policy?.enabled||!me)
          return json(res,403,{ok:false,error:'memory_sync_disabled'});
        const request=await body(req,60000),p=request?.payload;
        const peer=policy.devices.find(d=>d.deviceId===p?.deviceId&&d.selected);
        if(!peer)return json(res,403,{ok:false,error:'memory_sync_peer_not_selected'});
        const sourceGate=modules.scopeSyncGate({scopeId:p.scopeId,
          replicaDeviceId:id.deviceId,mode:me.mode,manualRequestSeq:me.manualRequestSeq||0});
        const targetGate=modules.scopeSyncGate({scopeId:p.scopeId,
          replicaDeviceId:peer.deviceId,mode:peer.mode,manualRequestSeq:peer.manualRequestSeq||0});
        if(!sourceGate.allowed||!targetGate.allowed)
          return json(res,403,{ok:false,error:'memory_sync_scope_mode_denied'});
        const result=modules.peerRequest(request);
        const revision=result?.payload?.result?.frame?.meta?.revision;
        if(revision!=null&&((sourceGate.uptoRevision!=null&&revision>sourceGate.uptoRevision)||
          (targetGate.uptoRevision!=null&&revision>targetGate.uptoRevision)))
          return json(res,409,{ok:false,error:'memory_sync_manual_revision_ceiling'});
        return json(res,200,{ok:true,result});
      }
      catch(error){return json(res,Number(error.status)||403,{ok:false,
        error:String(error.message||'peer_denied').slice(0,90)});}
    }
    if(auth?.enabled&&!auth.identity(req)){if(url.pathname.startsWith('/api/')||url.pathname==='/events')return json(res,401,{ok:false,error:'wall_auth_required'});res.writeHead(303,{location:`/login?next=${encodeURIComponent(safeNext(req.url||'/'))}`,'cache-control':'no-store'});return res.end();}
    if(req.method==='GET'&&['/','/long-memory','/codex-cli'].includes(url.pathname)){
      const view=url.pathname==='/'?'home':url.pathname==='/long-memory'?'memory':'codex';
      let html=wallPage(brandSvg,Boolean(auth?.enabled),auth?.enabled?auth.csrfForRequest(req)||'':'',auth?.enabled?auth.identity(req):null,Boolean(modules),view);
      if(view!=='home')html=html.replace('<details id="goldModulesPanel"','<details open id="goldModulesPanel"');if(!auth?.enabled||typeof getLocalProcesses!=='function')html=html.replace(/<a class="btn small" href="\/processes">.*?<\/a>/,'');res.writeHead(200,pageHeaders());res.end(html);return;}
    if(req.method==='GET'&&url.pathname==='/approve'){const html=approvePage(brandSvg,auth?.enabled?auth.csrfForRequest(req)||'':'');res.writeHead(200,pageHeaders());res.end(html);return;}
    if(req.method==='GET'&&url.pathname==='/processes'){
      if(!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'process_view_auth_required'});
      if(typeof getLocalProcesses!=='function')return json(res,501,{ok:false,error:'process_view_unavailable'});
      res.writeHead(200,pageHeaders());res.end(localProcessPage(auth.csrfForRequest(req)||''));return;
    }
    if(req.method==='GET'&&url.pathname==='/permissions'){const html=permissionsPage(brandSvg,auth?.enabled?auth.csrfForRequest(req)||'':'');res.writeHead(200,pageHeaders());res.end(html);return;}
    if(req.method==='GET'&&url.pathname==='/settings'){const html=updateSettingsHtml({surface:'local',csrfToken:auth?.enabled?auth.csrfForRequest(req)||'':'',brandHtml:brandSvg,modulesAvailable:Boolean(modules)});res.writeHead(200,pageHeaders());res.end(html);return;}
    if(url.pathname==='/api/gold/modules'&&req.method==='GET'){
      if(!modules||!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'gold_modules_owner_required'});
      return json(res,200,{ok:true,modules:modules.flags()});
    }
    if(url.pathname.startsWith('/api/gold/modules/')){
      if(!modules||!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'gold_modules_owner_required'});
      if(req.method==='POST'&&!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/configure')return json(res,200,{ok:true,modules:modules.configure(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/memory/delete/preview')
        return json(res,200,{ok:true,preview:modules.localMemoryDeletePreview()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/memory/delete/account')
        return json(res,501,{ok:false,error:'memory_account_delete_requires_durable_tombstone_and_offline_device_ack'});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/memory/delete/local'){
        const input=await body(req);
        if(input.confirmText!=='DELETE LOCAL MEMORY')
          return json(res,400,{ok:false,error:'memory_local_delete_confirmation_required'});
        if(typeof getMemoryAccountSyncPolicy!=='function'||typeof getMemoryAccountDevices!=='function')
          return json(res,503,{ok:false,error:'memory_sync_safety_status_unavailable'});
        const directory=await getMemoryAccountDevices();
        const record=await getMemoryAccountSyncPolicy({action:'get'});
        if(!record?.policy||!directory?.currentDeviceId)
          return json(res,503,{ok:false,error:'memory_sync_safety_status_unavailable'});
        const currentlySelected=(record.policy.devices||[]).find(d=>d.deviceId===directory.currentDeviceId);
        if(record.policy.enabled&&currentlySelected?.selected)
          return json(res,409,{ok:false,error:'memory_local_delete_disable_this_device_sync_first'});
        const result=modules.clearLocalMemory({confirmed:true});
        return json(res,200,{ok:true,result});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/memory')return json(res,200,{ok:true,note:modules.saveNote(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/memory')return json(res,200,{ok:true,notes:modules.notes({query:url.searchParams.get('query')||''})});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scopes')
        return json(res,200,{ok:true,scopes:modules.listMemoryScopes(),legacyUnassigned:modules.legacyUnassignedCount()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope')
        return json(res,200,{ok:true,scope:modules.createMemoryScope(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/capture')
        return json(res,200,{ok:true,policy:modules.changeScopeCapture(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/memory/usage')
        return json(res,200,{ok:true,usage:modules.localMemoryUsage()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/archive'){
        const input=await body(req);
        return json(res,200,{ok:true,result:modules.archiveMemoryScope({...input,ownerConfirmed:input.ownerConfirmed===true})});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/restore'){
        const input=await body(req);
        return json(res,200,{ok:true,result:modules.restoreMemoryScope({...input,ownerConfirmed:input.ownerConfirmed===true})});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/delete/local'){
        const input=await body(req);
        return json(res,200,{ok:true,result:modules.deleteMemoryScopeLocal({...input,ownerConfirmed:input.ownerConfirmed===true})});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/delete/account'){
        return json(res,501,{ok:false,error:'memory_scope_account_delete_requires_signed_tombstone_offline_delivery_and_acks'});
      }
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scope/context/preference')
        return json(res,200,{ok:true,preference:modules.fullContextPreference({scopeId:url.searchParams.get('scopeId')||''})});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/context/preference')
        return json(res,200,{ok:true,preference:modules.setFullContextPreference(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/context/save')
        return json(res,200,{ok:true,snapshot:modules.saveFullContext(await body(req,4*1024*1024))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scope/context/read')
        return json(res,200,{ok:true,context:modules.readFullContext({scopeId:url.searchParams.get('scopeId')||''})});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/auto/pending')
        return json(res,200,{ok:true,pending:modules.autoPending()});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/sync/account-policy'){
        if(typeof getMemoryAccountSyncPolicy!=='function')
          return json(res,503,{ok:false,error:'memory_account_sync_policy_unavailable'});
        const result=await getMemoryAccountSyncPolicy({action:'get'});
        return json(res,200,{ok:true,policy:result.policy});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/sync/account-policy'){
        if(typeof getMemoryAccountSyncPolicy!=='function')
          return json(res,503,{ok:false,error:'memory_account_sync_policy_unavailable'});
        const input=await body(req);
        const result=await getMemoryAccountSyncPolicy({action:'set',policy:input});
        return json(res,200,{ok:true,policy:result.policy});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/sync/manual'){
        if(typeof getMemoryAccountSyncPolicy!=='function')
          return json(res,503,{ok:false,error:'memory_account_sync_policy_unavailable'});
        const input=await body(req);
        const result=await getMemoryAccountSyncPolicy({action:'manual',deviceId:input.deviceId});
        return json(res,200,{ok:true,manual:result.manual});
      }
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/sync/selection')
        return json(res,200,{ok:true,...modules.deviceSyncOverview()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/sync/selection'){
        if(typeof getMemoryAccountDevices!=='function')
          return json(res,503,{ok:false,error:'memory_device_directory_unavailable'});
        const input=await body(req);
        if(typeof input.enabled!=='boolean'||!Array.isArray(input.selectedDeviceIds))
          return json(res,400,{ok:false,error:'memory_selection_invalid'});
        // Browser-provided device IDs are never authority. Validate all IDs
        // against a freshly enrollment-signed Account directory.
        const directory=await getMemoryAccountDevices();
        if(input.selectedDeviceIds.some(id=>id===directory.currentDeviceId||
          !directory.devices.some(d=>d.deviceId===id&&d.state!=='revoked')))
          return json(res,403,{ok:false,error:'memory_selection_cross_account_denied'});
        const selection=modules.setDeviceSyncSelection(input);
        return json(res,200,{ok:true,selection});
      }
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/sync/account-devices'){
        if(typeof getMemoryAccountDevices!=='function')
          return json(res,503,{ok:false,error:'memory_account_directory_unavailable'});
        try{
          const data=await getMemoryAccountDevices();
          return json(res,200,{ok:true,currentDeviceId:data.currentDeviceId,devices:data.devices});
        }catch(e){
          return json(res,503,{ok:false,error:'memory_account_directory_offline'});
        }
      }
      // Account-enrolled rendezvous: the browser selects device IDs only.
      // Agent device-channel signatures bind directory keys and invitations.
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/sync/inbox'){
        if(typeof getMemoryAccountInvites!=='function')
          return json(res,503,{ok:false,error:'memory_rendezvous_unavailable'});
        modules.syncIdentity(); // require optional Memory ON
        const result=await getMemoryAccountInvites({action:'list'});
        return json(res,200,{ok:true,invites:(result.invites||[]).map(x=>({
          inviteId:x.inviteId,homeDeviceId:x.homeDeviceId,
          scopeId:x.scopeId,scopeName:x.package?.invite?.displayName||'Memory scope',
          createdAt:x.createdAt
        }))});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/sync/offer'){
        if(typeof getMemoryAccountDevices!=='function'||typeof getMemoryAccountInvites!=='function')
          return json(res,503,{ok:false,error:'memory_rendezvous_unavailable'});
        const input=await body(req);
        if(input.ownerConfirmed!==true)return json(res,403,{ok:false,error:'memory_sync_owner_confirmation_required'});
        const roster=await getMemoryAccountDevices();
        const target=(roster.devices||[]).find(x=>x.deviceId===input.replicaDeviceId&&
          x.deviceId!==roster.currentDeviceId&&x.state!=='revoked'&&x.memoryIdentity);
        if(!target)return json(res,409,{ok:false,error:'memory_replica_identity_not_advertised'});
        const grant=modules.grantSyncReplica({scopeId:input.scopeId,peer:target.memoryIdentity,
          expectedFingerprint:target.memoryIdentity.fingerprint,ownerConfirmed:true});
        // Keep the owner-approved grant if delivery fails or times out:
        // the Replica cannot read a scope until it separately accepts.
        // Retrying this endpoint re-signs the SAME grant without rotating keys,
        // resetting ACK/outbox, or unintentionally revoking an existing peer.
        const offered=await getMemoryAccountInvites({action:'offer',package:grant});
        return json(res,200,{ok:true,offer:offered.result,reused:grant.reused===true});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/sync/accept-device'){
        if(typeof getMemoryAccountDevices!=='function'||typeof getMemoryAccountInvites!=='function')
          return json(res,503,{ok:false,error:'memory_rendezvous_unavailable'});
        const input=await body(req);
        if(input.ownerConfirmed!==true)return json(res,403,{ok:false,error:'memory_sync_owner_confirmation_required'});
        const inbox=await getMemoryAccountInvites({action:'list'});
        const message=(inbox.invites||[]).find(x=>x.inviteId===input.inviteId);
        if(!message)return json(res,404,{ok:false,error:'memory_sync_invitation_expired'});
        const roster=await getMemoryAccountDevices();
        const home=(roster.devices||[]).find(d=>d.deviceId===message.homeDeviceId&&d.memoryIdentity);
        const invitation=message.package?.invite;
        if(!home||!invitation||home.memoryIdentity.signPublicKey!==invitation.homeSignPublicKey||
          home.memoryIdentity.encPublicKey!==invitation.homeEncPublicKey)
          return json(res,409,{ok:false,error:'memory_home_identity_unverified'});
        const replica=modules.acceptSyncInvite({package:message.package,
          expectedHomeFingerprint:home.memoryIdentity.fingerprint,ownerConfirmed:true});
        await getMemoryAccountInvites({action:'ack',inviteId:input.inviteId});
        return json(res,200,{ok:true,replica});
      }
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/sync/identity')
        return json(res,200,{ok:true,identity:modules.syncIdentity()});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scope/sync/routes')
        return json(res,200,{ok:true,routes:modules.peerRoutes()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/sync/route')
        return json(res,200,{ok:true,route:modules.configurePeerRoute(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scope/sync/status')
        return json(res,200,{ok:true,sync:modules.syncStatus({scopeId:url.searchParams.get('scopeId')||''})});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/sync/policy')
        return json(res,200,{ok:true,policy:modules.changeScopeSyncPolicy(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/sync/grant'){
        const data=await body(req);
        return json(res,200,{ok:true,grant:modules.grantSyncReplica({...data,ownerConfirmed:data.ownerConfirmed===true})});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/sync/accept'){
        const data=await body(req);
        return json(res,200,{ok:true,replica:modules.acceptSyncInvite({...data,ownerConfirmed:data.ownerConfirmed===true})});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/sync/revoke'){
        const data=await body(req);
        return json(res,200,{ok:true,revoke:modules.revokeSyncReplica({...data,ownerConfirmed:data.ownerConfirmed===true})});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/bind')
        return json(res,200,{ok:true,binding:modules.bindMemoryScope(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/scope/checkpoint')
        return json(res,200,{ok:true,checkpoint:modules.appendScopedCheckpoint(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scope/handoff')
        return json(res,200,{ok:true,handoff:modules.scopedHandoff({scopeId:url.searchParams.get('scopeId')||'',limit:5})});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/scope/export')
        return json(res,200,{ok:true,export:modules.scopedExport({scopeId:url.searchParams.get('scopeId')||''})});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/checkpoint')
        return json(res,200,{ok:true,checkpoint:modules.saveCheckpoint(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/checkpoints')
        return json(res,200,{ok:true,checkpoints:modules.listCheckpoints({limit:15})});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/handoff')
        return json(res,200,{ok:true,handoff:modules.handoff({limit:5})});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/receipts')
        return json(res,200,{ok:true,receipts:modules.observerReceipts()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/receipt/approve')
        return json(res,200,{ok:true,transition:modules.confirmObserverTask(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/task')return json(res,200,{ok:true,task:modules.addTask(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/task/state')return json(res,200,{ok:true,task:modules.updateTask(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/task/edit')return json(res,200,{ok:true,task:modules.editTask(await body(req))});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/task/delete')return json(res,200,{ok:true,task:modules.deleteTask(await body(req))});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/codex-runtime/status')
        return json(res,200,{ok:true,runtime:modules.managedCodexStatus()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/codex-runtime/install'){
        const input=await body(req);
        if(input.ownerApproved!==true)return json(res,400,{ok:false,error:'codex_runtime_owner_approval_required'});
        return json(res,202,{ok:true,runtime:modules.installManagedCodexRuntime()});
      }
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/codex-runtime/remove'){
        const input=await body(req);
        if(input.confirmText!=='REMOVE CODEX RUNTIME')
          return json(res,400,{ok:false,error:'codex_runtime_remove_confirmation_required'});
        return json(res,200,{ok:true,runtime:modules.removeManagedCodexRuntime()});
      }
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/codex-plus/status')
        return json(res,200,{ok:true,account:await modules.codexPlusStatus()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/codex-plus/login')
        return json(res,200,{ok:true,login:await modules.codexPlusLogin()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/codex-plus/cancel')
        return json(res,200,{ok:true,result:await modules.codexPlusCancel()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/codex-plus/logout')
        return json(res,200,{ok:true,result:await modules.codexPlusLogout()});
      if(req.method==='POST'&&url.pathname==='/api/gold/modules/codex-plus/run')
        return json(res,200,{ok:true,result:await modules.codexPlusObserve()});
      if(url.pathname.startsWith('/api/gold/modules/codex/'))
        return json(res,410,{ok:false,error:'codex_platform_api_disabled_use_chatgpt_sign_in'});
      if(req.method==='GET'&&url.pathname==='/api/gold/modules/observer')return json(res,200,{ok:true,observer:modules.observer()});
      return json(res,404,{ok:false,error:'gold_modules_action_unavailable'});
    }
    if(req.method==='GET'&&url.pathname==='/api/policy-status'){const local=await (typeof getLocalPolicyStatus==='function'?getLocalPolicyStatus():getLocalStatus());return json(res,200,{ok:true,local});}
    if(req.method==='GET'&&url.pathname==='/api/status'){const value=await status();return json(res,200,{ok:true,...value});}
    if(req.method==='POST'&&url.pathname==='/api/update/check'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof requestUpdate!=='function')return json(res,501,{ok:false,error:'update_control_unavailable'});const value=await requestUpdate({mode:'check'});return json(res,200,{ok:true,update:value});}
    if(req.method==='POST'&&url.pathname==='/api/update/request'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof requestUpdate!=='function')return json(res,501,{ok:false,error:'update_control_unavailable'});const value=await requestUpdate({mode:'apply'});return json(res,200,{ok:true,update:value});}
    if(req.method==='POST'&&url.pathname==='/api/enrollment/begin'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof beginEnrollment!=='function')return json(res,501,{ok:false,error:'device_enrollment_unavailable'});const value=await beginEnrollment();return json(res,200,{ok:true,enrollment:value});}
    if(req.method==='POST'&&url.pathname==='/api/enrollment/poll'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof pollEnrollment!=='function')return json(res,501,{ok:false,error:'device_enrollment_unavailable'});const value=await pollEnrollment();return json(res,200,{ok:true,enrollment:value});}
    if(req.method==='POST'&&url.pathname==='/api/capabilities/rescan'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof rescanCapabilities!=='function')return json(res,501,{ok:false,error:'capability_rescan_unavailable'});const result=await rescanCapabilities();return json(res,200,{ok:true,result});}
    if(req.method==='POST'&&url.pathname==='/api/permissions'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof setPermissions!=='function')return json(res,501,{ok:false,error:'permission_control_unavailable'});const data=await body(req);const value=await setPermissions(data||{});return json(res,200,{ok:true,policy:value});}
    if(req.method==='GET'&&url.pathname==='/api/filesystem-volumes'){
      if(!auth?.enabled||!auth.identity(req))return json(res,401,{ok:false,error:'wall_auth_required'});
      if(typeof getFilesystemVolumes!=='function')return json(res,501,{ok:false,error:'filesystem_volume_inventory_unavailable'});
      const value=await getFilesystemVolumes();return json(res,200,{ok:true,...value});
    }
    if(req.method==='POST'&&url.pathname==='/api/filesystem-roots'){
      if(!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'filesystem_owner_auth_required'});
      if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});
      if(typeof setFilesystemRoots!=='function')return json(res,501,{ok:false,error:'filesystem_scope_control_unavailable'});
      const data=await body(req);const value=await setFilesystemRoots(data||{});
      return json(res,200,{ok:true,filesystemRoots:value});
    }
    if(req.method==='POST'&&url.pathname==='/api/permissions/owner-approve'){
      if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});
      if(auth?.mode!=='account-only'||typeof ownerApprovePermissions!=='function')return json(res,403,{ok:false,error:'owner_account_auth_required'});
      const email=String(auth.identity(req)?.username||'');if(!email.includes('@'))return json(res,403,{ok:false,error:'account_owner_login_required'});
      const request=await body(req);const result=await ownerApprovePermissions({email,password:request.password,approvedCapabilities:request.approvedCapabilities,profile:request.profile});
      return json(res,200,{ok:true,policy:result});
    }
    if(req.method==='POST'&&url.pathname==='/api/pairing-code'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof pairingCode!=='function')return json(res,501,{ok:false,error:'pairing_unavailable'});const data=await body(req);console.log(JSON.stringify({event:'local_wall_pairing_code_requested',rotate:data.rotate===true}));const value=await pairingCode({rotate:data.rotate===true});return json(res,200,{ok:true,pairing:value});}
    if(req.method==='POST'&&url.pathname==='/api/owner-proof-code'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof ownerProofCode!=='function')return json(res,501,{ok:false,error:'owner_proof_unavailable'});const value=await ownerProofCode();return json(res,200,{ok:true,proof:value});}
    if(req.method==='GET'&&url.pathname==='/api/processes'){
      if(!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'process_view_auth_required'});
      if(typeof getLocalProcesses!=='function')return json(res,501,{ok:false,error:'process_view_unavailable'});
      const list=await getLocalProcesses();
      return json(res,200,{ok:true,scope:'device_agent_local',processes:Array.isArray(list)?list.slice(0,64):[]});
    }
    if(req.method==='POST'&&url.pathname==='/api/processes/stop'){
      if(!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'process_stop_auth_required'});
      if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});
      if(typeof stopLocalProcess!=='function')return json(res,501,{ok:false,error:'process_stop_unavailable'});
      const input=await body(req),processId=String(input.processId||'');
      if(!/^lp_[A-Za-z0-9_-]{20,80}$/.test(processId))return json(res,400,{ok:false,error:'invalid_process_id'});
      if(typeof input.force!=='boolean')return json(res,400,{ok:false,error:'invalid_stop_mode'});
      const process=await stopLocalProcess({processId,force:input.force});
      console.log(JSON.stringify({event:'owner_local_wall_process_stop',processId,force:input.force,state:process?.state||null}));
      return json(res,200,{ok:true,scope:'device_agent_local',process});
    }
    if(req.method==='GET'&&url.pathname==='/api/pty/sessions'){
      // PTY data is more sensitive than job metadata. Require an authenticated
      // Local Wall session even when loopback-only Wall runs without login.
      if(!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'pty_view_auth_required'});
      if(typeof getLocalTerminals!=='function')return json(res,501,{ok:false,error:'pty_view_unavailable'});
      const rows=await getLocalTerminals();return json(res,200,{ok:true,scope:'device_agent_local',terminals:Array.isArray(rows)?rows.slice(0,64):[]});
    }
    if(req.method==='GET'&&url.pathname==='/api/pty/output'){
      if(!auth?.enabled||!auth.identity(req))return json(res,403,{ok:false,error:'pty_view_auth_required'});
      if(typeof readLocalTerminal!=='function')return json(res,501,{ok:false,error:'pty_view_unavailable'});
      const terminalId=String(url.searchParams.get('terminalId')||'');
      if(!/^ltm_[A-Za-z0-9_-]{20,80}$/.test(terminalId))return json(res,400,{ok:false,error:'invalid_terminal_id'});
      const rawOffset=String(url.searchParams.get('offset')||'0');
      if(!/^[0-9]{1,16}$/.test(rawOffset)||!Number.isSafeInteger(Number(rawOffset)))return json(res,400,{ok:false,error:'invalid_output_offset'});
      try{return json(res,200,{ok:true,scope:'device_agent_local',terminal:await readLocalTerminal(terminalId,{offset:Number(rawOffset),limit:32768})});}
      catch(error){const code=String(error?.message||'');return json(res,code==='terminal_not_found'?404:403,{ok:false,error:code==='terminal_not_found'?'terminal_not_found':'pty_view_unavailable'});}
    }
    if(req.method==='GET'&&url.pathname==='/api/activity'){const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit'))||500,5000));const local=await getLocalStatus();if(!local?.cloudDesiredConnected||local?.cloudState!=='connected'||typeof getRemoteActivity!=='function')return json(res,200,{ok:true,events:[]});try{const value=await getRemoteActivity(limit);return json(res,200,{ok:true,events:value?.events||[]});}catch(error){return json(res,200,{ok:true,events:[],warning:error.message});}}
    if(req.method==='GET'&&url.pathname==='/events'){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store',connection:'keep-alive','x-accel-buffering':'no'});
      res.write(`event: hello\ndata: ${JSON.stringify({ok:true,now:new Date().toISOString()})}\n\n`);
      activityClients.add(res);ensureActivityPump();
      let closed=false;const keep=setInterval(()=>{if(!closed)res.write(`: keepalive ${Date.now()}\n\n`);},20000);
      req.on('close',()=>{closed=true;clearInterval(keep);activityClients.delete(res);stopActivityPumpIfIdle();});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/approve'){const found=await resolveCode(url.searchParams.get('code'));return json(res,200,{ok:true,request:{requestId:found.requestId,agentId:found.agentId,label:found.label,userCode:found.userCode,expiresAt:found.expiresAt,deviceName:found.deviceName}});}
    if(req.method==='POST'&&url.pathname==='/api/approve'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const data=await body(req),found=await resolveCode(data.code),decision=String(data.decision||'');console.log(JSON.stringify({event:'local_wall_access_decision_requested',requestId:found.requestId,agentId:found.agentId,decision}));if(decision==='approve'){if(typeof accessApprove!=='function')return json(res,501,{ok:false,error:'access_control_unavailable'});const value=await accessApprove(found.requestId);return json(res,200,{ok:true,decision:'approved',authorization:value});}if(decision==='deny'){if(typeof accessDeny!=='function')return json(res,501,{ok:false,error:'access_control_unavailable'});const value=await accessDeny(found.requestId,{reason:'owner_denied'});return json(res,200,{ok:true,decision:'denied',authorization:value});}return json(res,400,{ok:false,error:'invalid_approval_decision'});}
    if(req.method==='POST'&&url.pathname==='/api/connect'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const data=await body(req);const value=await connect(data||{});return json(res,200,{ok:true,connection:value});}
    if(req.method==='POST'&&url.pathname==='/api/disconnect'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const data=await body(req);const value=await disconnect(data||{});return json(res,200,{ok:true,connection:value});}
    if(req.method==='POST'&&url.pathname==='/api/grace'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const data=await body(req);const value=await setGrace(data||{});return json(res,200,{ok:true,connection:value});}if(req.method==='POST'&&url.pathname==='/api/session-close'){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});if(typeof closeSession!=='function')return json(res,501,{ok:false,error:'session_control_unavailable'});const data=await body(req);console.log(JSON.stringify({event:'local_wall_session_close_requested',sessionId:String(data.sessionId||''),agentId:String(data.agentId||'')}));const value=await closeSession(data||{}),closed=value?.session||value;if(closed?.state!=='closed')return json(res,409,{ok:false,error:'session_close_unconfirmed'});statusCache?.invalidate();return json(res,200,{ok:true,session:closed});}

    const access=url.pathname.match(/^\/api\/access\/(pa_[A-Za-z0-9_-]{20,80})\/(approve|deny)$/);if(req.method==='POST'&&access){if(!mutationAllowed(req))return json(res,403,{ok:false,error:'csrf_invalid'});const data=await body(req);const fn=access[2]==='approve'?accessApprove:accessDeny;if(typeof fn!=='function')return json(res,501,{ok:false,error:'access_control_unavailable'});const value=await fn(access[1],data||{});return json(res,200,{ok:true,authorization:value});}
    return json(res,404,{ok:false,error:'not_found'});
  }catch(error){const code=String(error?.message||'local_wall_error');console.error(JSON.stringify({event:'local_wall_request_error',method:String(req.method||''),route:new URL(req.url||'/','http://local.wall').pathname,error:code.slice(0,240),headersSent:res.headersSent}));if(res.headersSent||res.writableEnded){if(!res.writableEnded)res.destroy();return;}return json(res,Number(error?.status)||400,{ok:false,error:code});}});
  server.listen(Number(port),host);return{server,host,port:Number(port),url:`http://${host}:${Number(port)}/`,close:()=>{shutdownActivityPump();return new Promise(resolve=>server.close(()=>resolve()));}};
}
