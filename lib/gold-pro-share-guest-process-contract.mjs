import crypto from 'node:crypto';
export class GoldGuestProcessContractError extends Error {
 constructor(code,status=400){super(code);this.name='GoldGuestProcessContractError';this.status=status;}
}
const deny=(code)=>{throw new GoldGuestProcessContractError(code)};
const FIELDS=['type','script','cwd','shell','timeoutMs'];
const exact=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
export function normalizeGoldGuestProcessIntent(payload){
 if(!exact(payload,FIELDS))deny('guest_payload_extra_or_missing_fields');
 if(payload.type!=='process-start'||typeof payload.script!=='string'||
    !payload.script.trim()||Buffer.byteLength(payload.script,'utf8')>8192||
    /[\u0000]/.test(payload.script)||
    typeof payload.cwd!=='string'||payload.cwd.length>512||
    /[\u0000]/.test(payload.cwd)||
    !['bash','sh','pwsh','powershell','cmd'].includes(payload.shell)||
    !Number.isSafeInteger(payload.timeoutMs)||
    payload.timeoutMs<1000||payload.timeoutMs>300000)
  deny('guest_payload_process_contract_denied');
 return Object.freeze({...payload});
}
export function goldGuestIntentHash(payload){
 const p=normalizeGoldGuestProcessIntent(payload);
 return crypto.createHash('sha256')
  .update(JSON.stringify(['gold-pro-share-process-v1',p.type,p.script,
   p.cwd,p.shell,p.timeoutMs])).digest('hex');
}
