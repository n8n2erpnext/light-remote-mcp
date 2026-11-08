import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const need=(v,n)=>{if(!v)throw new Error(n);};
const brand=new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname;
const wall=startLocalWall({
 host:'127.0.0.1',port:0,brandSvgPath:brand,auth:{enabled:false},
 getLocalStatus:async()=>({deviceName:'golden-test',deviceId:'golden-test',cloudDesiredConnected:false,cloudState:'dormant',version:'0.9.0-rc.30',effectiveCapabilities:[],fleetWall:{healthy:false}}),
 getRemoteStatus:async()=>null,getRemoteActivity:async()=>({events:[]}),
 connect:async()=>({}),disconnect:async()=>({}),setGrace:async()=>({}),setPermissions:async()=>({}),
 pairingCode:async()=>({code:'ABCD-EFGH',expiresAt:Date.now()+60000}),
 closeSession:async data=>({session:{sessionId:data.sessionId||'test'}}),requestUpdate:async()=>({})
});
await new Promise(r=>wall.server.once('listening',r));
const port=wall.server.address().port;
const html=await new Promise((resolve,reject)=>{
 http.get({host:'127.0.0.1',port,path:'/'},res=>{let s='';res.setEncoding('utf8');res.on('data',c=>s+=c);res.on('end',()=>resolve(s));}).on('error',reject);
});
await wall.close();

need(html.includes('opbadge op-neutral')||html.includes('.opbadge.op-neutral'),'neutral_badge_missing');
need(html.includes('<span>Settings</span>'),'settings_icon_button_missing');
need(html.includes('toastHost')&&html.includes('function notify(')&&html.includes('function copyText('),'toast_feedback_missing');
need(html.includes("window.isSecureContext&&navigator.clipboard")&&html.includes("document.execCommand('copy')"),'clipboard_insecure_context_fallback_missing');
need(html.includes("node.setAttribute('aria-hidden','true')")&&html.includes("node?.remove()"),'clipboard_fallback_cleanup_missing');
need(html.includes('lr-spin360')&&html.includes("classList.add('spinning')"),'refresh_spin_missing');
need(html.includes('sessionActions')&&html.includes('/api/session-close'),'session_cleanup_contract_missing');
need(html.includes('Close held sessions'),'session_cleanup_ui_missing');
need(html.includes('Command copied')&&html.includes('Output copied')&&html.includes('Raw job copied'),'copy_feedback_missing');
need(html.includes('Visible jobs copied')&&html.includes('Operator stream paused'),'action_feedback_missing');
need(html.includes('A code refreshed')&&html.includes('Cloud connected')&&html.includes('Cloud disconnected'),'connection_feedback_missing');

const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
need(scripts.length>=1,'wall_script_missing');
for(const [i,src] of scripts.entries()){new vm.Script(src,{filename:`wall-inline-${i}.js`});}
const main=scripts[0];
const copyStart=main.indexOf('async function copyText('),copyEnd=main.indexOf('function confirmAction',copyStart);
need(copyStart>=0&&copyEnd>copyStart,'copy_function_extract_failed');
const copySource=main.slice(copyStart,copyEnd);
async function exerciseCopy({secure,clipboardOk=true,fallbackOk=true}){
  const calls={clipboard:0,fallback:0,removed:0,notify:[]},active={focus(){}},node={style:{},value:'',setAttribute(){},focus(){},select(){},setSelectionRange(){},remove(){calls.removed++;}};
  const context={
    window:{isSecureContext:secure},
    navigator:{clipboard:secure?{writeText:async value=>{calls.clipboard++;if(!clipboardOk)throw new Error('denied');calls.clipboardValue=value;}}:undefined},
    document:{activeElement:active,body:{appendChild(){}},createElement:type=>{need(type==='textarea','clipboard_fallback_not_textarea');return node;},execCommand:cmd=>{need(cmd==='copy','clipboard_fallback_wrong_command');calls.fallback++;return fallbackOk;}},
    notify:(message,kind)=>calls.notify.push([message,kind])
  };
  const fn=vm.runInNewContext('('+copySource.replace(/^async function copyText/,'async function')+')',context);
  calls.result=await fn('SV66-LAM7','A copied');
  calls.value=node.value;
  return calls;
}
const secureCopy=await exerciseCopy({secure:true});
need(secureCopy.result&&secureCopy.clipboard===1&&secureCopy.fallback===0&&secureCopy.notify.at(-1)?.[0]==='A copied','clipboard_secure_path_failed');
const insecureCopy=await exerciseCopy({secure:false});
need(insecureCopy.result&&insecureCopy.clipboard===0&&insecureCopy.fallback===1&&insecureCopy.value==='SV66-LAM7'&&insecureCopy.removed===1&&insecureCopy.notify.at(-1)?.[0]==='A copied','clipboard_http_fallback_failed');
const deniedSecureCopy=await exerciseCopy({secure:true,clipboardOk:false});
need(deniedSecureCopy.result&&deniedSecureCopy.clipboard===1&&deniedSecureCopy.fallback===1&&deniedSecureCopy.removed===1,'clipboard_denied_fallback_failed');
const failedCopy=await exerciseCopy({secure:false,fallbackOk:false});
need(!failedCopy.result&&failedCopy.notify.at(-1)?.[0]==='Copy failed','clipboard_failure_feedback_failed');
need(!/(^|[^A-Za-z])alert\s*\(/.test(main),'browser_alert_present_in_main_wall');
need(!/(^|[^A-Za-z])confirm\s*\(/.test(main),'browser_confirm_present_in_main_wall');

const source=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
need(source.includes("url.pathname==='/api/session-close'")&&source.includes('closeSession,requestUpdate'),'session_close_backend_missing');
need(source.includes("import { materialIcon } from '../lib/material-icon.mjs';")&&source.includes("${materialIcon('settings')}")&&fs.existsSync(new URL('../../assets/icons/material/settings.svg',import.meta.url)),'settings_icon_source_missing');
need(source.includes("background:#d7dbe0;color:#0a0c0f"),'neutral_badge_palette_wrong');
console.log('v091-golden-wall-polish=PASS');
