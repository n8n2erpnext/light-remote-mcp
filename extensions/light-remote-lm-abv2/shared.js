'use strict';
// One extension core for the explicit local or NetBird Wall selection.
globalThis.LightRemoteMemory=Object.freeze({
 maxBytes:512*1024,ttlMs:10*60*1000,
 wall(input){
  const u=new URL(input);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','100.94.184.141'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||!['/','/long-memory'].includes(u.pathname))throw Error('Choose a local or approved NetBird Light Remote Wall URL.');
  return {url:u.origin+'/long-memory',permission:u.origin+'/*'};
 },
 provider(input){try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password?({ 'chatgpt.com':'chatgpt','claude.ai':'claude'}[u.hostname]??null):null;}catch{return null;}},
 conversation(input){
  try{
   const u=new URL(input),provider=this.provider(input);
   if(!provider||u.port)return null;
   const valid=provider==='chatgpt'?/^\/(?:g\/[\w-]+\/)?c\/[\w-]{8,100}$/:/^\/chat\/[\w-]{8,100}$/;
   return valid.test(u.pathname)?u.origin+u.pathname:null;
  }catch{return null;}
 },
 async hash(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');},
 async readSnapshot(read,{onlySettled=false,maxBytes=this.maxBytes}={}){
  let offset=0,first=null;
  const chunks=[];
  for(let i=0;i<40;i++){
   const page=await read({offset,expectedSha256:first?.sha256??null,maxBytes:65536,onlySettled});
   if(!page?.ok)throw Error(page?.error??'This page is not ready.');
   first??=page;
   if(page.sha256!==first.sha256||page.sourceUrl!==first.sourceUrl||page.turns!==first.turns||page.totalBytes!==first.totalBytes||page.offset!==offset){
    throw Error('Conversation changed during capture. Capture again when it is ready.');
   }
   if(page.totalBytes>maxBytes)throw Error('This conversation is too large to capture. Nothing was truncated.');
   chunks.push(page.chunk);
   if(page.nextOffset===null){
    const text=chunks.join('');
    if(new TextEncoder().encode(text).byteLength!==first.totalBytes||await this.hash(text)!==first.sha256){
     throw Error('Capture integrity check failed. Please capture again.');
    }
    return {text,turns:first.turns,sha256:first.sha256,sourceUrl:first.sourceUrl};
   }
   if(page.nextOffset<=offset)throw Error('Capture did not advance.');
   offset=page.nextOffset;
  }
  throw Error('Capture was incomplete. Nothing was prepared.');
 },
 async validCapture(x){
  if(x?.ok!==true||!['chatgpt','claude'].includes(x.provider)||this.provider(x.url)!==x.provider||x.coverage!=='loaded_dom_only'||!Number.isInteger(x.turns)||x.turns<1||typeof x.text!=='string'||!x.text.trim()||new TextEncoder().encode(x.text).byteLength>this.maxBytes)return false;
  return x.contentSha256===await this.hash(x.text);
 }
});
