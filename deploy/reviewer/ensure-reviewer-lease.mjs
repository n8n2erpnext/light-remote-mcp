import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i>0?[x.slice(0,i).replace(/^--/,''),x.slice(i+1)]:[x.replace(/^--/,''),true]}));
const stateFile=String(args.state||process.env.OPERATOR_AGENT_STATE||'').trim();
const agent=String(args.agent||'').trim();
const hub=String(args.hub||'https://light-remote.thaiduy.digital').replace(/\/$/,'');
const leaseHours=Math.max(1,Math.min(Number(args['lease-hours']||72)||72,72));
const graceMinutes=Math.max(15,Math.min(Number(args['grace-minutes']||60)||60,60));
const now=Number(args.now)||Date.now();
if(!stateFile)throw new Error('state_required');
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const state=read();
if(!state?.enrollment?.deviceId)throw new Error('device_not_enrolled');
const expiry=Number(state.cloud?.hardExpiresAt),live=state.cloud?.desiredConnected===true&&state.cloud?.state==='connected'&&Number.isFinite(expiry)&&expiry>now;
if(live){console.log(JSON.stringify({ok:true,action:'noop',deviceId:state.enrollment.deviceId,hardExpiresAt:expiry}));process.exit(0);}
if(args['check-only']){console.log(JSON.stringify({ok:true,action:'reconnect-required',deviceId:state.enrollment.deviceId}));process.exit(0);}
if(!agent)throw new Error('agent_required');
const result=spawnSync(process.execPath,[agent,'connect',`--hub=${hub}`,`--lease-hours=${leaseHours}`,`--grace-minutes=${graceMinutes}`,'--silent'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile},encoding:'utf8',timeout:30000});
if(result.error)throw result.error;
if(result.status!==0)throw new Error(`reviewer_reconnect_failed:${String(result.stderr||result.stdout||'').trim().slice(0,240)}`);
const after=read(),afterExpiry=Number(after.cloud?.hardExpiresAt);
if(after.cloud?.desiredConnected!==true||after.cloud?.state!=='connected'||!Number.isFinite(afterExpiry)||afterExpiry<=Date.now())throw new Error('reviewer_reconnect_not_persisted');
console.log(JSON.stringify({ok:true,action:'reconnected',deviceId:after.enrollment.deviceId,hardExpiresAt:afterExpiry}));
