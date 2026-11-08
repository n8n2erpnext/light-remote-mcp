// A local, current-user instance proof. NOT an Owner/B grant or a cloud token.
// A different listener on the same port cannot answer this fresh challenge
// without the private device-local installation key.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DOMAIN='lr-goldabv2-wall-v1';
const KEY_RE=/^[a-f0-9]{64}$/;
const NONCE_RE=/^[a-f0-9]{64}$/;

export function loadOrCreateWallInstanceKey(file){
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  try{
    const fd=fs.openSync(file,'wx',0o600);
    try{fs.writeSync(fd,crypto.randomBytes(32).toString('hex')+'\n');fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
  }catch(error){if(error.code!=='EEXIST')throw error;}
  const key=fs.readFileSync(file,'utf8').trim();
  if(!KEY_RE.test(key))throw Error('goldabv2_local_instance_key_invalid');
  return Buffer.from(key,'hex');
}

export function wallInstanceMessage({nonce,pid,productId,profile,revision}){
  if(!NONCE_RE.test(String(nonce))||!Number.isSafeInteger(pid)||pid<1||
    productId!=='goldabv2-desktop-v4'||profile!=='goldabv2-lab'||
    !Number.isSafeInteger(revision)||revision<1)
    throw Error('wall_instance_request_invalid');
  return [DOMAIN,nonce,String(pid),productId,profile,String(revision)].join('\n');
}

export function createLocalWallInstanceProof({keyFile,routePath,productId,profile,revision}){
  if(!/^\/api\/[a-z0-9/_-]+$/.test(routePath)||routePath.includes('//'))
    throw Error('wall_instance_route_invalid');
  const key=loadOrCreateWallInstanceKey(keyFile);
  return Object.freeze({routePath,
    respond(nonce){
      const pid=process.pid;
      const message=wallInstanceMessage({nonce,pid,productId,profile,revision});
      return {ok:true,productId,profile,configRevision:revision,pid,
        mac:crypto.createHmac('sha256',key).update(message).digest('hex')};
    }});
}
