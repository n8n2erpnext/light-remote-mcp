import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertExecutionEpoch,signReconnectInventory} from '../lib/gold-reconnect-proof.mjs';
import {verifyExecutionGrant,verifyExecutionCommand} from '../lib/gold-execution-epoch.mjs';

// Private, fsynced write-ahead journal: no cleanup by age and no silent truncation.
// A reservation can mean a possible OS side effect, even when PID is absent.
export class AgentExecutionEpochJournal {
  constructor({directory,maxRecords=8192}={}){
    if(!path.isAbsolute(String(directory||'')))throw Error('epoch_journal_absolute_path_required');
    this.directory=directory;this.file=path.join(directory,'gold-execution-epoch-v1.json');
    this.maxRecords=maxRecords;this.rows=new Map();this.grant=null;this.load();
  }
  load(){
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    const mode=fs.statSync(this.directory).mode;
    if(process.platform!=='win32'&&(mode&0o077))throw Error('epoch_journal_directory_not_private');
    try{
      const stat=fs.lstatSync(this.file);
      if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)))throw Error('epoch_journal_unsafe_file');
      const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.version!==1||!Array.isArray(data.rows)||data.rows.length>this.maxRecords)throw Error('epoch_journal_invalid');
      this.grant=data.grant||null;
      for(const row of data.rows){
        if(!row?.commandId||this.rows.has(row.commandId))throw Error('epoch_journal_duplicate');
        this.rows.set(row.commandId,row);
      }
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  save(){
    const temp=path.join(this.directory,'.epoch-'+crypto.randomBytes(8).toString('hex')+'.tmp');
    let fd;
    try{
      fd=fs.openSync(temp,'wx',0o600);
      fs.writeFileSync(fd,JSON.stringify({version:1,grant:this.grant,rows:[...this.rows.values()]}));
      fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
      fs.renameSync(temp,this.file);
      if(process.platform!=='win32'){
        const d=fs.openSync(this.directory,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
      }
    }finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);try{fs.rmSync(temp,{force:true})}catch{}}
  }
  acceptGrant(statement,{accountId,deviceId,instanceId,publicKey}={}){
    const previous=String(this.grant?.executionEpoch||'1');
    const grant=verifyExecutionGrant(statement,{accountId,deviceId,instanceId,publicKey,minimumEpoch:previous});
    this.grant=grant;this.save();return grant;
  }
  checkCommand(command,{accountId,deviceId,publicKey}={}){
    const granted=this.grant;
    if(!granted)throw Error('execution_grant_missing');
    const ticket=verifyExecutionCommand(command,{grant:granted,accountId,deviceId,publicKey});
    assertExecutionEpoch({commandEpoch:ticket.executionEpoch,currentEpoch:granted.executionEpoch,authenticated:true});
    return ticket;
  }
  reserve(command,{accountId,deviceId,publicKey}={}){
    const ticket=this.checkCommand(command,{accountId,deviceId,publicKey});
    if(this.rows.has(command.commandId)){
      const prev=this.rows.get(command.commandId);
      if(prev.jobId!==command.jobId||prev.executionEpoch!==ticket.executionEpoch)throw Error('execution_command_id_conflict');
      return {previous:true,row:prev};
    }
    if(this.rows.size>=this.maxRecords)throw Error('execution_journal_full_fail_closed');
    const row={commandId:command.commandId,jobId:command.jobId,operationId:String(command.payload?.operationId||'unknown'),
      executionEpoch:ticket.executionEpoch,processId:null,state:'reserved',startedAt:Date.now(),finishedAt:null};
    this.rows.set(command.commandId,row);
    try{this.save()}catch(error){this.rows.delete(command.commandId);throw error;}
    return row;
  }
  finish(command,result){
    const row=this.rows.get(command.commandId);
    if(!row)throw Error('execution_command_not_reserved');
    const process=result?.data?.process;
    const pid=String(process?.processId||'');
    if(/^lp_[A-Za-z0-9_-]{20,80}$/.test(pid))row.processId=pid;
    // The command's successful launch is NOT a terminal result for its child.
    row.state=row.processId&&['finished','stopped','timeout','error','running'].includes(process.state)?process.state:'unknown';
    row.startedAt=Number.isSafeInteger(process?.startedAt)?process.startedAt:row.startedAt;
    row.finishedAt=Number.isSafeInteger(process?.finishedAt)?process.finishedAt:null;
    this.save();
  }
  observeProcesses(observed,{accountId,deviceId}={}){
    if(!Array.isArray(observed))throw Error('execution_process_inventory_probe_invalid');
    const byId=new Map(observed.filter(p=>p?.accountId===accountId&&p?.deviceId===deviceId&&
      /^lp_[A-Za-z0-9_-]{20,80}$/.test(String(p.processId||''))).map(p=>[p.processId,p]));
    let changed=false;
    for(const row of this.rows.values()){
      if(!row.processId)continue;
      const current=byId.get(row.processId);
      if(!current)continue; // Missing process is NOT a terminal receipt.
      if(Number.isSafeInteger(current.startedAt)&&row.startedAt>current.startedAt+1000)
        continue; // PID/process reuse or contradictory timeline; fail closed.
      if(['running','finished','stopped','timeout','error','unknown'].includes(current.state)&&
          row.state!==current.state){row.state=current.state;changed=true;}
      if(Number.isSafeInteger(current.pid)&&current.pid>0&&row.pid!==current.pid){row.pid=current.pid;changed=true;}
      if(Number.isSafeInteger(current.startedAt)&&current.startedAt>0&&
        row.nativeStartedAt!==current.startedAt){row.nativeStartedAt=current.startedAt;changed=true;}
      if(Number.isSafeInteger(current.finishedAt)&&current.finishedAt>0&&
        row.finishedAt!==current.finishedAt){row.finishedAt=current.finishedAt;changed=true;}
    }
    if(changed)this.save();
    return {observed:byId.size,updated:changed};
  }
  inventoryPages({accountId,deviceId,privateKey,now=Date.now()}={}){
    if(!this.grant||this.grant.accountId!==accountId||this.grant.deviceId!==deviceId)
      throw Error('execution_inventory_grant_missing');
    const rows=[...this.rows.values()];
    if(rows.length>8192)throw Error('execution_inventory_capacity_exceeded');
    const count=Math.max(1,Math.ceil(rows.length/128));
    const snapshotId=crypto.randomBytes(16).toString('hex');
    const pages=[];
    for(let i=0;i<count;i++){
      const processes=rows.slice(i*128,(i+1)*128).map(row=>({jobId:row.jobId,processId:row.processId,
        operationId:row.operationId,state:row.state,startedAt:row.startedAt,
        ...(Number.isSafeInteger(row.pid)?{pid:row.pid}:{}),
        ...(Number.isSafeInteger(row.nativeStartedAt)?{nativeStartedAt:row.nativeStartedAt}:{})}));
      // Legacy pre-epoch commands cannot be enumerated from this journal;
      // these pages are complete for tracked rows only, never an absence proof.
      const proof={version:1,accountId,deviceId,challenge:this.grant.challenge,
        executionEpoch:this.grant.executionEpoch,capturedAt:now,snapshotId,
        pageIndex:i,pageCount:count,totalItems:rows.length,complete:false,processes};
      pages.push(signReconnectInventory(proof,privateKey));
    }
    return pages;
  }
  inventory(options={}){return this.inventoryPages(options)[0];}
}
