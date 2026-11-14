import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {writeNativeArtifact,verifyNativeArtifact} from './rmv2-native-artifact.mjs';
test('source/hash/file set bind the SAME tested native binaries before installer intake',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-native-artifact-'));const source={sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),ciRunId:'1',version:'test'};
 try{
  fs.mkdirSync(path.join(root,'helper'));fs.mkdirSync(path.join(root,'fixture'));fs.writeFileSync(path.join(root,'helper/LightRemote.RM.exe'),'helper');fs.writeFileSync(path.join(root,'fixture/LightRemote.RM.TextFixture.exe'),'fixture');
  writeNativeArtifact(root,source);assert.equal(verifyNativeArtifact(root,source).files.length,2);
  assert.throws(()=>verifyNativeArtifact(root,{...source,sourceCommit:'c'.repeat(40)}),/source_mismatch/);
  fs.writeFileSync(path.join(root,'helper/LightRemote.RM.exe'),'tamper');assert.throws(()=>verifyNativeArtifact(root,source),/hash_mismatch/);
  fs.writeFileSync(path.join(root,'helper/LightRemote.RM.exe'),'helper');fs.writeFileSync(path.join(root,'helper/extra.dll'),'extra');assert.throws(()=>verifyNativeArtifact(root,source),/file_set/);
 }finally{
  const target=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(target),parent,'only remove this test directory');
  assert.ok(path.basename(target).startsWith('lr-native-artifact-'));
  fs.rmSync(target,{recursive:true,force:true});
 }
});
