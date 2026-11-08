import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function safeName(value){
  const text=String(value||'light-remote-selftest').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
  return text||'light-remote-selftest';
}

export function ipcEndpoint(prefix='light-remote-selftest'){
  const id=`${safeName(prefix)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  return process.platform==='win32'
    ? `\\\\.\\pipe\\${id}`
    : path.join(os.tmpdir(),`${id}.sock`);
}

export function removeIpcEndpoint(endpoint){
  if(process.platform==='win32')return;
  try{fs.rmSync(String(endpoint),{force:true});}catch{}
}

async function canConnect(endpoint){
  return await new Promise(resolve=>{
    const socket=net.createConnection(endpoint);
    let settled=false;
    const done=value=>{
      if(settled)return;
      settled=true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect',()=>done(true));
    socket.once('error',()=>done(false));
    socket.setTimeout(500,()=>done(false));
  });
}

export async function waitForIpc(endpoint,{attempts=100,delayMs=40,error='ipc_not_ready',details=null}={}){
  const tries=Math.max(1,Math.min(Number(attempts)||100,500));
  const delay=Math.max(1,Math.min(Number(delayMs)||40,1000));
  for(let i=0;i<tries;i++){
    if(await canConnect(endpoint))return true;
    if(i+1<tries)await sleep(delay);
  }
  let suffix='';
  try{
    const value=typeof details==='function'?details():details;
    if(value!=null&&String(value).trim())suffix=':'+String(value).trim().slice(0,4000);
  }catch{}
  throw new Error(String(error||'ipc_not_ready')+suffix);
}
