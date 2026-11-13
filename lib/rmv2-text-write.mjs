import crypto from 'node:crypto';
export {default as strictSemanticValue} from './rmv2-semantic-value.cjs';

export const RM_TEXT_INLINE_UNITS=262144;
export const RM_TEXT_REFERENCE_UNITS=8*1024*1024;
export const RM_TEXT_REFERENCE_BYTES=16*1024*1024;
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const fail=code=>{throw new Error(code);};

export function normalizeLogicalTextRequest(value){
  if(!value||typeof value!=='object')fail('desktop_text_request_required');
  const inline=typeof value.text==='string',reference=typeof value.sourcePath==='string';
  if(inline===reference)fail('desktop_text_choose_text_or_source_path');
  const result={mode:value.mode??'insert',verification:value.verification??'prefer',intervalMs:value.intervalMs??0,maxDurationMs:value.maxDurationMs??600000};
  if(!Number.isInteger(result.maxDurationMs)||result.maxDurationMs<1000||result.maxDurationMs>3600000)fail('desktop_text_invalid_deadline');
  if(!['insert','append'].includes(result.mode))fail('desktop_text_invalid_mode');
  if(!['none','prefer','required'].includes(result.verification))fail('desktop_text_invalid_verification');
  if(!Number.isInteger(result.intervalMs)||result.intervalMs<0||result.intervalMs>100)fail('desktop_text_invalid_interval');
  if(inline){
    if(!value.text.length||value.text.length>RM_TEXT_INLINE_UNITS)fail('desktop_text_transport_budget_use_content_reference');
    if(!value.text.isWellFormed()||value.text.includes('\0'))fail('desktop_text_invalid_unicode');
    result.text=value.text;
  }else{
    if(!value.sourcePath.length||value.sourcePath.length>4096||/[\x00-\x1f]/.test(value.sourcePath))fail('desktop_text_invalid_source_path');
    if(typeof value.sourceSha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sourceSha256))fail('desktop_text_source_sha256_required');
    result.sourcePath=value.sourcePath;result.sourceSha256=value.sourceSha256.toLowerCase();
  }
  if(value.desktopSessionId!=null){
    if(typeof value.desktopSessionId!=='string'||!/^desk_[A-Za-z0-9_-]{8,120}$/.test(value.desktopSessionId))fail('desktop_input_invalid_desktop_session');
    result.desktopSessionId=value.desktopSessionId;
  }
  return result;
}

export function prepareLogicalText(value,{reference=false}={}){
  if(!value||typeof value.text!=='string'||!value.text.length)fail('desktop_text_string_required');
  const text=value.text,max=reference?RM_TEXT_REFERENCE_UNITS:RM_TEXT_INLINE_UNITS;
  if(text.length>max||Buffer.byteLength(text)>RM_TEXT_REFERENCE_BYTES)fail('desktop_text_transport_budget_use_content_reference');
  if(!text.isWellFormed()||text.includes('\0'))fail('desktop_text_invalid_unicode');
  const intervalMs=value.intervalMs??0;
  if(!Number.isInteger(intervalMs)||intervalMs<0||intervalMs>100)fail('desktop_text_invalid_interval');
  const mode=value.mode??'insert',verification=value.verification??'prefer',maxDurationMs=value.maxDurationMs??600000;
  if(!Number.isInteger(maxDurationMs)||maxDurationMs<1000||maxDurationMs>3600000)fail('desktop_text_invalid_deadline');
  if(!['insert','append'].includes(mode))fail('desktop_text_invalid_mode');
  if(!['none','prefer','required'].includes(verification))fail('desktop_text_invalid_verification');
  const units=intervalMs===0?512:Math.max(1,Math.min(512,Math.floor(250/intervalMs)));
  const chunks=[];let pending='';
  // Validate the whole logical write before target preparation or any input.
  // No chunk boundary may split surrogate/combining/ZWJ sequences or CRLF.
  for(const {segment} of segmenter.segment(text)){
    if(segment.length>4096||segment.length*intervalMs>2000)fail('desktop_text_grapheme_packet_budget');
    if(pending&&pending.length+segment.length>units){chunks.push(pending);pending='';}
    pending+=segment;
  }
  if(pending)chunks.push(pending);
  return {text,chunks,intervalMs,mode,verification,maxDurationMs,requestedUnits:text.length,requestedBytes:Buffer.byteLength(text),
    fingerprint:crypto.createHash('sha256').update(text).update('\0'+mode+'\0'+verification+'\0'+intervalMs+'\0'+maxDurationMs).digest('hex')};
}

const actorKey=owner=>String(owner.sessionId||'')+'\0'+String(owner.agentId||'');
const terminal=new Set(['verified','unverified','mismatch','interrupted','cancelled','indeterminate','failed']);

// Device-local bounded orchestration. Status/logs contain no text/readback.
// Hub relays initial tool input; progress/readback expose metadata only.
// A restart does NOT resume/replay an uncertain input prefix.
export class RmTextWrites {
  constructor({native,withScope,isScopeOpen=()=>true,authorize=async()=>({validForMs:1000}),monotonic=()=>performance.now(),now=Date.now,id=()=> 'write_'+crypto.randomBytes(16).toString('base64url')}={}){
    this.authorize=authorize;this.monotonic=monotonic;this.native=native;this.withScope=withScope;this.isScopeOpen=isScopeOpen;this.now=now;this.id=id;
    this.rows=new Map();this.operations=new Map();this.active=null;
  }
  prune(){
    for(const [id,row] of this.rows)if(terminal.has(row.state)&&this.now()-row.updatedAt>900000){this.rows.delete(id);this.operations.delete(row.operationKey);}
    if(this.rows.size>=128)for(const [id,row] of this.rows){if(terminal.has(row.state)){this.rows.delete(id);this.operations.delete(row.operationKey);break;}}
  }
  view(row){
    return {writeId:row.id,state:row.state,desktopSessionId:row.scope.desktopSessionId,mode:row.mode,verificationRequested:row.verification,
      requestedUnits:row.requestedUnits,requestedBytes:row.requestedBytes,acceptedUnits:row.requestedUnits,
      sentUnits:row.sentUnits,lastAcknowledgedSentUnits:row.lastAck,verifiedInsertedUnits:row.verifiedUnits,
      progressMeaning:'UTF16 input events accepted; not verified document insertion',
      remainingUnits:row.sentUnits==null?null:Math.max(0,row.requestedUnits-row.sentUnits),
      contentVerification:row.contentVerification,verificationMethod:row.verificationMethod??null,
      target:row.target??null,reason:row.reason??null,createdAt:row.createdAt,updatedAt:row.updatedAt,
      automaticReplay:false,resumable:false,reconciliationRequired:['interrupted','indeterminate','mismatch'].includes(row.state)||(row.state==='cancelled'&&(row.sentUnits==null||row.sentUnits>0)),
      closeRequired:true,closeBeforeFinalReport:true};
  }
  owned(owner,id){const row=this.rows.get(String(id));if(!row)fail('desktop_write_unknown_after_restart_or_expiry_do_not_replay');if(row.actor!==actorKey(owner))fail('desktop_write_owner_mismatch');return row;}
  status(owner,id){this.prune();return this.view(this.owned(owner,id));}
  async start(owner,scope,request,{reference=false}={}){
    this.prune();const prepared=prepareLogicalText(request,{reference});
    const key=actorKey(owner)+'\0'+String(request.operationId||'');
    if(!request.operationId)fail('desktop_write_operation_id_required');
    const prior=this.operations.get(key);
    if(prior){const old=this.owned(owner,prior);if(old.fingerprint!==prepared.fingerprint||old.scope.desktopSessionId!==scope.desktopSessionId)fail('desktop_write_operation_conflict');return this.view(old);}
    if(this.active)fail('desktop_logical_write_busy');
    if(this.rows.size>=128)fail('desktop_write_receipt_capacity');
    const row={id:this.id(),actor:actorKey(owner),scope,operationKey:key,fingerprint:prepared.fingerprint,
      mode:prepared.mode,verification:prepared.verification,requestedUnits:prepared.requestedUnits,requestedBytes:prepared.requestedBytes,
      sentUnits:0,lastAck:0,verifiedUnits:null,contentVerification:'unverified',state:'preparing',cancel:false,
      owner,deadline:this.monotonic()+prepared.maxDurationMs,authorityUntil:0,createdAt:this.now(),updatedAt:this.now()};
    this.rows.set(row.id,row);this.operations.set(key,row.id);this.active=row;
    try{
      await this.checkAuthority(row);
      const target=await this.native.start(scope,{writeId:row.id,requestedUnits:row.requestedUnits,mode:row.mode,verification:row.verification});
      row.target=target.target??null;row.verificationMethod=target.verificationMethod??null;
      if(row.verification==='required'&&target.verificationAvailable!==true)fail('desktop_text_verification_unavailable');
      if(!this.isScopeOpen(scope))fail('desktop_write_task_closed_during_preflight');
      row.state='running';
      row.promise=Promise.resolve(this.withScope(scope,()=>this.run(row,prepared))).catch(async error=>{
        if(!terminal.has(row.state)){
          row.state='cancelled';row.reason=String(error?.message||'desktop_write_task_closed');row.updatedAt=this.now();
          try{await this.native.finish(scope,{writeId:row.id,complete:false});}catch{}
          if(this.active===row)this.active=null;
          prepared.text='';prepared.chunks.length=0;
        }
        return this.view(row);
      });
      row.promise.catch(()=>{}); // run records terminal metadata; never fire-and-forget input errors.
      return this.view(row);
    }catch(error){
      row.state='failed';row.reason=String(error?.message||'desktop_write_preflight_failed');row.updatedAt=this.now();
      try{await this.native.finish(scope,{writeId:row.id,complete:false});}catch{}
      if(this.active===row)this.active=null;
      throw error;
    }
  }
  async checkAuthority(row){
    if(this.monotonic()>=row.deadline)throw Error('desktop_write_deadline_exceeded');
    if(!this.isScopeOpen(row.scope))throw Error('desktop_write_task_closed');
    // Local policy is checked by the injected callback even on a cached server snapshot.
    const started=this.monotonic(),result=await this.authorize(row.owner,row.scope,Math.max(0,row.authorityUntil-started));
    if(result){
      if(!Number.isFinite(result.validForMs)||result.validForMs<=0)throw Error('desktop_write_authority_denied');
      row.authorityUntil=started+Math.min(1000,result.validForMs);
    }
    if(this.monotonic()>=row.deadline||this.monotonic()>=row.authorityUntil)throw Error('desktop_write_authority_expired');
  }
  async run(row,prepared){
    try{
      for(const text of prepared.chunks){
        if(row.cancel||!this.isScopeOpen(row.scope)){row.state='cancelled';row.reason='cancel_or_task_close';break;}
        try{await this.checkAuthority(row);}catch(error){row.state='interrupted';row.reason=String(error?.message||'desktop_write_authority_denied');break;}
        if(row.cancel||!this.isScopeOpen(row.scope)){row.state='cancelled';row.reason='cancel_or_task_close';break;}
        const offset=row.lastAck;
        const ack=await this.native.chunk(row.scope,{writeId:row.id,offset,text,intervalMs:prepared.intervalMs});
        const sent=ack.sentUnits;
        if(!Number.isInteger(sent)||sent<row.lastAck||sent>row.lastAck+text.length)fail('desktop_write_invalid_progress');
        row.sentUnits=sent;row.lastAck=sent;row.updatedAt=this.now();
        if(ack.state&&ack.state!=='running'){row.state=ack.state==='cancelled'?'cancelled':'interrupted';row.reason=ack.reason??null;break;}
        if(sent!==offset+text.length)fail('desktop_write_incomplete_chunk');
      }
      let complete=row.state==='running'&&row.lastAck===row.requestedUnits&&!row.cancel;
      if(complete)try{await this.checkAuthority(row);}catch(error){complete=false;row.state='interrupted';row.reason=String(error?.message||'desktop_write_authority_denied');}
      const final=await this.native.finish(row.scope,{writeId:row.id,complete});
      row.contentVerification=final.contentVerification??'unverified';row.verificationMethod=final.verificationMethod??row.verificationMethod;
      if(final.verifiedInsertedUnits!=null){
        if(!Number.isInteger(final.verifiedInsertedUnits)||final.verifiedInsertedUnits<0||final.verifiedInsertedUnits>row.lastAck)fail('desktop_write_invalid_verification_receipt');
        row.verifiedUnits=final.verifiedInsertedUnits;
      }
      if(complete)row.state=row.contentVerification==='verified'&&row.verifiedUnits===row.requestedUnits?'verified':row.contentVerification==='mismatch'?'mismatch':'unverified';
      else if(row.state==='running')row.state=row.cancel?'cancelled':'interrupted';
    }catch(error){
      // A lost final chunk/response has unknown effects. Keep the last ACK as
      // evidence, never claim it is the next safe content insertion offset.
      row.reason=String(error?.message||'desktop_write_unknown_effect');row.verifiedUnits=null;
      if(row.reason==='operation_cancelled_before_start'){
        row.state='cancelled';row.sentUnits=row.lastAck;row.contentVerification='unverified';
      }else{
        row.state='indeterminate';row.sentUnits=null;row.contentVerification='indeterminate';
      }
      try{await this.native.finish(row.scope,{writeId:row.id,complete:false});}catch{}
    }finally{
      row.updatedAt=this.now();if(this.active===row)this.active=null;
      prepared.text='';prepared.chunks.length=0;
    }
    return this.view(row);
  }
  async cancel(owner,id){
    const row=this.owned(owner,id);if(terminal.has(row.state))return {...this.view(row),alreadyTerminal:true};
    row.cancel=true;row.updatedAt=this.now();
    await this.native.cancel(row.scope,{writeId:row.id});
    return {...this.view(row),cancelRequested:true};
  }
}
