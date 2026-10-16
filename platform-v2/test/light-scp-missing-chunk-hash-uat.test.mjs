import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {LightScpFileRegistry} from '../../lib/light-scp-file.mjs';

// The connected Light Remote SCP tool advertises NO per-chunk SHA-256 prop.
// The library explicitly supports the omitted optional SHA and must keep
// strict full-file SHA-256 validation on commit. This is a DEV regression,
// not a claim the deployed MCP/Agent adapter now correctly forwards arguments.
test('source SCP library accepts missing optional chunk SHA but verifies whole file',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-scp-optional-hash-'));
  const files=new LightScpFileRegistry({policy:{
    readRoots:[dir],writeRoots:[dir],downloadRoots:[dir],uploadRoots:[dir]
  }});
  try{
    const bytes=Buffer.from('hello'), hash=crypto.createHash('sha256').update(bytes).digest('hex');
    const dest=path.join(dir,'fixture.txt');
    const upload=await files.beginUpload({destination:dest,totalBytes:bytes.length,
      sha256:hash,chunkBytes:65536,overwrite:false});
    const result=await files.putUploadChunk(upload.id,{index:0,data:bytes.toString('base64url')});
    assert.equal(result.receivedBytes,5);
    const committed=await files.commitUpload(upload.id);
    assert.equal(committed.sha256,hash);
    assert.equal(fs.readFileSync(dest,'utf8'),'hello');
    const downloaded=await files.beginDownload({source:dest});
    const chunk=await files.readDownloadChunk(downloaded.id,{index:0});
    assert.equal(chunk.data,bytes.toString('base64url'));
    assert.equal(chunk.sha256,hash);
    await files.cancel(downloaded.id);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('source SCP library rejects invalid explicit chunk hash; never treats blank as verified',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-scp-hash-deny-'));
  const files=new LightScpFileRegistry({policy:{
    readRoots:[dir],writeRoots:[dir],downloadRoots:[dir],uploadRoots:[dir]
  }});
  try{
    const bytes=Buffer.from('hello');
    const correct=crypto.createHash('sha256').update(bytes).digest('hex');
    const upload=await files.beginUpload({destination:path.join(dir,'no-commit'),
      totalBytes:5,sha256:correct});
    await assert.rejects(files.putUploadChunk(upload.id,{
      index:0,data:bytes.toString('base64url'),sha256:''
    }),/scp_invalid_sha256/);
    await assert.rejects(files.putUploadChunk(upload.id,{
      index:0,data:bytes.toString('base64url'),sha256:'0'.repeat(64)
    }),/scp_chunk_hash_mismatch/);
    const state=await files.status(upload.id);
    assert.equal(state.receivedBytes,0);
    await assert.rejects(files.commitUpload(upload.id),/scp_upload_incomplete/);
    await files.cancel(upload.id);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
