import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareScpUploadChunk} from '../../plugin-server/scp-chunk-integrity.mjs';
import {LightScpRegistry} from '../../lib/light-scp-registry.mjs';
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const owner={accountId:'uat-account',deviceId:'uat-device',sessionId:'uat-session',agentId:'uat-agent'};
const make=bytes=>({transferId:'lscp_0123456789012345678901234',index:0,data:bytes.toString('base64url')});

test('public SCP plugin derives missing SHA-256 from decoded canonical base64url bytes',()=>{
  const src=Buffer.from('hello');
  assert.deepEqual(prepareScpUploadChunk(make(src)),{
    op:'upload-chunk',...make(src),sha256:hash(src)});
});
test('explicit canonical hash is retained and independently verified before forwarding',()=>{
  const b=Buffer.from('hello');
  const r=prepareScpUploadChunk({...make(b),sha256:hash(b).toUpperCase()});
  assert.equal(r.sha256,hash(b));
});
test('explicit incorrect hash is denied before any Agent or remote dispatch',()=>{
  assert.throws(()=>prepareScpUploadChunk({...make(Buffer.from('hello')),
    sha256:'0'.repeat(64)}),/scp_chunk_hash_mismatch/);
});
test('explicit blank hash is rejected instead of silently being treated as omitted',()=>{
  assert.throws(()=>prepareScpUploadChunk({...make(Buffer.from('hello')),
    sha256:''}),/scp_invalid_sha256/);
});
test('invalid base64, padding, invalid utf8 are byte-safe or rejected canonically',()=>{
  for(const s of ['aGVsbG8=','aGVsbG8+','a','💥','', 'AAAA.']){
    assert.throws(()=>prepareScpUploadChunk({data:s}),/scp_invalid_chunk_encoding/,s);
  }
  const binary=Buffer.from([0,255,2,3,128,0,13]);
  assert.equal(prepareScpUploadChunk(make(binary)).sha256,hash(binary),
    'hash bytes, not Unicode string');
});
test('oversized 6MB public payload rejected before decoding',()=>{
  assert.throws(()=>prepareScpUploadChunk({data:'A'.repeat(6_000_001)}),
    /scp_invalid_chunk_encoding/);
});
test('old Agent requiring per-chunk SHA and current leaf library both accept adapted bytes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-scp-adapter-'));
  const registry=new LightScpRegistry({policy:{readRoots:[dir],writeRoots:[dir],
    uploadRoots:[dir],downloadRoots:[dir]}});
  try{
    const bytes=crypto.randomBytes(140_005);
    const dest=path.join(dir,'strict-transfer.bin');
    const session=await registry.beginUpload(owner,{destination:dest,totalBytes:bytes.length,
      sha256:hash(bytes),chunkBytes:65536});
    for(let i=0;i<3;i++){
      const slice=bytes.subarray(i*65536,Math.min(bytes.length,(i+1)*65536));
      const adapted=prepareScpUploadChunk({
        transferId:session.id,index:i,data:slice.toString('base64url')});
      assert.equal(adapted.sha256,hash(slice),'older Agent requires explicit per-chunk sha');
      await registry.putUploadChunk(owner,session.id,adapted);
    }
    const committed=await registry.commitUpload(owner,session.id);
    assert.equal(committed.sha256,hash(bytes));
    assert.equal(hash(fs.readFileSync(dest)),hash(bytes));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bad chunk never alters the transfer state, while same client can retry good hash',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-scp-integrity-'));
  const registry=new LightScpRegistry({policy:{readRoots:[dir],writeRoots:[dir],
    uploadRoots:[dir],downloadRoots:[dir]}});
  try{
    const bytes=Buffer.from('hello');
    const session=await registry.beginUpload(owner,{destination:path.join(dir,'s.txt'),
      totalBytes:5,sha256:hash(bytes)});
    assert.throws(()=>prepareScpUploadChunk({...make(bytes),transferId:session.id,
      sha256:'f'.repeat(64)}),/scp_chunk_hash_mismatch/);
    assert.equal((await registry.status(owner,session.id)).receivedBytes,0);
    const adapted=prepareScpUploadChunk({...make(bytes),transferId:session.id});
    await registry.putUploadChunk(owner,session.id,adapted);
    assert.equal((await registry.commitUpload(owner,session.id)).sha256,hash(bytes));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
