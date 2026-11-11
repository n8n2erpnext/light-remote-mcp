// Composition of existing native Owner -> enrolled Agent -> Wall contracts.
// No Google credentials, new browser token exchange, or A/B grants live here.
import {createGoldAbv2AgentWallSsoBridgeV4} from './desktop-wall-sso-agent-transport-v4.mjs';
import {createDesktopWallSsoAgentFamilyCurrentV4} from './desktop-wall-sso-family-current-v4.mjs';
import {startNativeWallSsoAgentIpcV4} from './desktop-wall-sso-native-ipc-v4.mjs';

const LAB='https://goldabv2.light-remote.thaiduy.digital';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
export function createAgentWallSsoRuntimeV4({hub,base,host,authEnabled,env=process.env,
  readState,signChannel,fetchImpl=fetch,startIpc=startNativeWallSsoAgentIpcV4}={}){
  const enabled=env.LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4==='1'&&hub===LAB&&base===LAB&&
    host==='127.0.0.1'&&authEnabled===true;
  let ready=false,closed=false,listener=null,starting=null;
  function enrollment(){
    const current=readState?.(),row=current?.enrollment;
    if(!row||!ID.test(String(row.accountId||''))||!ID.test(String(row.deviceId||'')))return null;
    return {accountId:row.accountId,deviceId:row.deviceId,
      revoked:row.revoked===true||Boolean(row.revokedAt)||
        ['device_revoked','device_removed'].includes(String(current.cloud?.lastError||''))};
  }
  if(enabled&&(typeof readState!=='function'||typeof signChannel!=='function'||
      typeof fetchImpl!=='function'||typeof startIpc!=='function'))
    throw Error('desktop_wall_sso_runtime_unavailable');
  const bridge=enabled?createGoldAbv2AgentWallSsoBridgeV4({readEnrollment:enrollment,signChannel,fetchImpl}):null;
  const family=enabled?createDesktopWallSsoAgentFamilyCurrentV4({readEnrollment:enrollment,signChannel,fetchImpl}):null;
  const options=Object.freeze({enabled,
    isNativeReady:()=>ready&&!closed&&enrollment()?.revoked===false,
    redeemSignedTicket:ticket=>{
      if(!enabled||closed)throw Error('desktop_wall_sso_runtime_unavailable');
      return bridge.redeem(ticket);
    },verifyLiveOwnerFamily:input=>enabled&&!closed?family.verifyLiveOwnerFamily(input):Promise.resolve(false)});
  async function start(wall){
    if(!enabled||closed)return false;
    if(listener)return options.isNativeReady();
    if(starting)return starting;
    starting=(async()=>{
      try{
        const handle=await startIpc({enabled:true,wall,getEnrollment:enrollment});
        if(handle?.enabled!==true||typeof handle.close!=='function')throw Error('unavailable');
        if(closed){await handle.close();return false;}
        listener=handle;ready=true;return options.isNativeReady();
      }catch{ready=false;return false;}
    })();
    try{return await starting;}finally{starting=null;}
  }
  async function close(){
    closed=true;ready=false;
    if(starting)await starting;
    const handle=listener;listener=null;
    if(handle)await handle.close();
  }
  return Object.freeze({options,start,close});
}
