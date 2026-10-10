import fs from 'node:fs';
import path from 'node:path';

export const FREE_LIMIT=10_000;
export class FreeBenefitError extends Error{
  constructor(message,details={}){super(message);this.status=429;Object.assign(this,details);}
}
const monthAt=ms=>new Date(ms).toISOString().slice(0,7);
const nextMonth=k=>{const [y,m]=k.split('-').map(Number);return Date.UTC(y,m,1);};
export class FreeBenefitRegistry{
  constructor({stateFile=null,now=()=>Date.now(),mode='shadow',verifyRotationProof=null}={}){
    if(!['shadow','enforce'].includes(mode))throw Error('invalid_free_benefit_mode');
    this.stateFile=stateFile;this.now=now;this.mode=mode;this.verifyRotationProof=verifyRotationProof;
    const prior=stateFile&&fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
    if(prior&&prior.schemaVersion!==1)throw Error('invalid_free_benefit_state');
    this.families=prior?.families||{};this.buckets=prior?.buckets||{};
  }
  _save(){
    if(!this.stateFile)return;
    fs.mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o750});
    const tmp=this.stateFile+'.'+process.pid+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,families:this.families,buckets:this.buckets})+'\n',{mode:0o600});
    fs.renameSync(tmp,this.stateFile);
  }
  _family(deviceId){
    const id=String(deviceId||'');
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id))throw Error('invalid_benefit_device');
    return this.families[id]||id;
  }
  _historical(family,month,usageAccounts={}){
    const ids=new Set([family]);
    for(const [id,group] of Object.entries(this.families))if(group===family)ids.add(id);
    let used=0;
    for(const account of Object.values(usageAccounts)){
      const devices=account?.months?.[month]?.devices||{};
      for(const id of ids)used+=Math.max(0,Number(devices[id]?.toolCalls)||0);
    }
    return used;
  }
  status({deviceId,usageAccounts={}}={}){
    const family=this._family(deviceId),month=monthAt(this.now()),key=family+'|'+month;
    const used=Math.max(Number(this.buckets[key]?.used)||0,this._historical(family,month,usageAccounts));
    return {family,month,key,used,remaining:Math.max(0,FREE_LIMIT-used),limit:FREE_LIMIT,resetAt:nextMonth(month),mode:this.mode};
  }
  // Called synchronously just before SessionRegistry records the tool call.
  reserve({accountId,deviceId,plan='free',accountUsed=0,usageAccounts={},chargeId=null}={}){
    if(['pro','vip'].includes(String(plan).toLowerCase()))return {allowed:true,paid:true};
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(String(accountId||'')))throw Error('invalid_benefit_account');
    const view=this.status({deviceId,usageAccounts}),prev=this.buckets[view.key]||{used:0,charges:{}};
    const id=chargeId==null?null:String(accountId)+'|'+String(chargeId);
    if(id&&prev.charges[id])return {allowed:true,idempotent:true,...view};
    const scope=accountUsed>=FREE_LIMIT?'account':view.used>=FREE_LIMIT?'device_family':null;
    if(scope&&this.mode==='enforce')throw new FreeBenefitError(scope==='account'?'tool_call_quota_exceeded':'free_device_allowance_exhausted',
      {scope,used:scope==='account'?accountUsed:view.used,limit:FREE_LIMIT,resetAt:view.resetAt});
    const charges={...prev.charges};
    if(id)charges[id]=this.now();
    this.buckets[view.key]={used:Math.max(prev.used,view.used)+1,charges};
    this._save();
    return {allowed:true,wouldBlock:Boolean(scope),scope,...view};
  }
  // Never trust a client-supplied family ID. Link only after signed proof.
  linkRotation({oldDeviceId,newDeviceId,proof}={}){
    const old=this._family(oldDeviceId),next=this._family(newDeviceId);
    if(!this.verifyRotationProof||this.verifyRotationProof({oldDeviceId,newDeviceId,proof})!==true)
      throw new FreeBenefitError('installation_rotation_proof_required',{status:403});
    if(old!==next){
      for(const [key,row] of Object.entries(this.buckets)){
        if(!key.startsWith(next+'|'))continue;
        const target=old+key.slice(next.length),prior=this.buckets[target];
        this.buckets[target]={used:(prior?.used||0)+row.used,charges:{...(prior?.charges||{}),...row.charges}};
        delete this.buckets[key];
      }
    }
    this.families[newDeviceId]=old;this._save();return {family:old};
  }
}
