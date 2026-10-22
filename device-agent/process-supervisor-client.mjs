import http from 'node:http';
import fs from 'node:fs';
import {NativeProcessError} from '../lib/native-process.mjs';

// Explicit enabled mode is fail-closed: do not silently re-launch using Agent memory.
export class ProcessSupervisorClient {
  constructor({socketPath,tokenFile}={}){
    if(!socketPath||!tokenFile)throw Error('supervisor_socket_and_token_required');
    this.socketPath=socketPath;this.tokenFile=tokenFile;
  }
  async request(op,owner,data={}){
    const token=fs.readFileSync(this.tokenFile,'utf8').trim();
    return new Promise((resolve,reject)=>{
      const payload=JSON.stringify({op,owner,...data});
      const req=http.request({socketPath:this.socketPath,method:'POST',path:'/v1/process',timeout:15000,
        headers:{'x-lr-supervisor-token':token,'content-type':'application/json','content-length':Buffer.byteLength(payload)}},res=>{
          const chunks=[];let size=0;
          res.on('data',c=>{size+=c.length;if(size>2*1024*1024){req.destroy(new Error('supervisor_response_too_large'));return;}chunks.push(c);});
          res.on('end',()=>{
            try{const body=JSON.parse(Buffer.concat(chunks).toString());if(!body.ok)return reject(new NativeProcessError(body.error||'supervisor_command_failed',res.statusCode));resolve(body);}
            catch(e){reject(e);}
          });
        });
      req.on('timeout',()=>req.destroy(new Error('supervisor_request_timeout')));
      req.on('error',e=>reject(new NativeProcessError('supervisor_unavailable:'+String(e.code||e.message).slice(0,60),503)));
      req.end(payload);
    });
  }
  async start(input){const {accountId,deviceId,sessionId,agentId,...command}=input;return (await this.request('start',{accountId,deviceId,sessionId,agentId},command)).process;}
  async list(owner){return (await this.request('list',owner)).processes;}
  async listDevice(accountId,deviceId){return (await this.request('list-device',{accountId,deviceId})).processes;}
  async listUnackedTerminals(accountId,deviceId){return (await this.request('list-device-terminals',{accountId,deviceId})).receipts;}
  async ackTerminals(accountId,deviceId,receipts){return this.request('ack-device-terminals',{accountId,deviceId},{receipts});}
  async stop(processId,owner,{force=false}={}){return (await this.request('stop',owner,{processId,force})).process;}
  async input(processId,owner,options={}){return (await this.request('input',owner,{processId,...options})).process;}
  async output(processId,owner,options={}){return (await this.request('output',owner,{processId,...options})).data;}
}
