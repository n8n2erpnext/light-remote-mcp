import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { LightScpRegistry } from '../../lib/light-scp-registry.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-scp-owner-'));
const policy={readRoots:[root],writeRoots:[root],uploadRoots:[root],downloadRoots:[root]};
const reg=new LightScpRegistry({policy,ttlMs:30000});
const owner={accountId:'acct-a',deviceId:'dev-a',sessionId:'session-a',agentId:'agent-a-0000000001'};
const other={...owner,agentId:'agent-b-0000000002'};
const data=Buffer.from('owner-bound-transfer'),sha=crypto.createHash('sha256').update(data).digest('hex');
const up=await reg.beginUpload(owner,{destination:path.join(root,'owner.bin'),totalBytes:data.length,sha256:sha});
let denied=false;try{await reg.status(other,up.id);}catch(e){denied=e.message==='scp_owner_mismatch'&&e.status===403;}
assert.ok(denied,'scp_owner_isolation_failed');
await reg.putUploadChunk(owner,up.id,{index:0,data:data.toString('base64url'),sha256:sha});
await reg.commitUpload(owner,up.id);
console.log('v10-light-scp-owner-isolation=PASS');
fs.rmSync(root,{recursive:true,force:true});
