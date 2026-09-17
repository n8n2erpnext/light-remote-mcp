import fs from 'node:fs';
import path from 'node:path';

const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i>0?[x.slice(0,i).replace(/^--/,''),x.slice(i+1)]:[x.replace(/^--/,''),true]}));
const file=String(args.state||'').trim();
if(!file)throw new Error('state_required');
const requested=String(args.allowed||'build-test,filesystem,git,terminal').split(',').map(x=>x.trim()).filter(Boolean);
const state=JSON.parse(fs.readFileSync(file,'utf8'));
if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
const grantable=[...new Set([...(state.enrollment.grantableCapabilities||state.enrollment.approvedCapabilities||[])].map(String))].sort();
const allowed=requested.filter(x=>grantable.includes(x));
if(!allowed.length)throw new Error('allowed_capabilities_empty');
const denied=grantable.filter(x=>!allowed.includes(x));
state.policy={...(state.policy||{}),deniedCapabilities:denied,localProfile:'custom',localFinalDenyBoundary:true,localPolicyUpdatedAt:Date.now()};
state.effectiveCapabilities=allowed;
const tmp=`${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp,`${JSON.stringify(state,null,2)}\n`,{mode:0o600});
fs.chmodSync(tmp,0o600);fs.renameSync(tmp,file);fs.chmodSync(file,0o600);
console.log(JSON.stringify({ok:true,deviceId:state.enrollment.deviceId,allowedCapabilities:allowed,deniedCapabilities:denied}));
