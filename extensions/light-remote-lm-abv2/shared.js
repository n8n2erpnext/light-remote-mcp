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
 async hash(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');},
 async validCapture(x){
  if(x?.ok!==true||!['chatgpt','claude'].includes(x.provider)||this.provider(x.url)!==x.provider||x.coverage!=='loaded_dom_only'||!Number.isInteger(x.turns)||x.turns<1||typeof x.text!=='string'||!x.text.trim()||new TextEncoder().encode(x.text).byteLength>this.maxBytes)return false;
  return x.contentSha256===await this.hash(x.text);
 }
});
