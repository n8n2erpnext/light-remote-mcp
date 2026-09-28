import fs from 'node:fs';
import vm from 'node:vm';
import {StringDecoder} from 'node:string_decoder';

const agent=fs.readFileSync('device-agent/operator-agent.mjs','utf8');
const executor=fs.readFileSync('operator-host/executor.mjs','utf8');
const wall=fs.readFileSync('device-agent/local-wall.mjs','utf8');
const dashboard=fs.readFileSync('gateway/dashboard.mjs','utf8');

const start=agent.indexOf('function likelyBinaryBytes');
const end=agent.indexOf('async function executeProcessCommand',start);
if(start<0||end<=start)throw new Error('output_collector_slice_missing');
const {boundedCollector,likelyBinaryBytes}=vm.runInNewContext(agent.slice(start,end)+';({boundedCollector,likelyBinaryBytes})',{Buffer,StringDecoder,MAX_OUTPUT:4*1024*1024});

const phrase='Thiết bị này có các quyền UTF-8 tiếng Việt';
const bytes=Buffer.from(phrase,'utf8'),needle=Buffer.from('ế'),pos=bytes.indexOf(needle);
if(pos<0)throw new Error('utf8_probe_missing');
const collector=boundedCollector();
collector.add(bytes.subarray(0,pos+1));
collector.add(bytes.subarray(pos+1));
if(collector.text()!==phrase)throw new Error('utf8_split_decoder_failed');

const gzip=Buffer.from([0x1f,0x8b,0x08,0,0,0,0,0,0,3,1,2,3,4]);
const binary=boundedCollector();binary.add(gzip);const rendered=binary.text();
if(!rendered.includes('binary output suppressed')||rendered.includes('�'))throw new Error('binary_suppression_failed');
if(!likelyBinaryBytes(Buffer.from([0,1,0,0,0,12,0,128,0,3,0,80])))throw new Error('ttf_detection_failed');

for(const [name,src] of [['wall',wall],['dashboard',dashboard]]){
  const a=src.indexOf("const LEGACY_BINARY_MARKER="),b=src.indexOf('function eventKey(e)',a);
  if(a<0||b<=a)throw new Error(name+'_sanitizer_slice_missing');
  const x=vm.runInNewContext(src.slice(a,b)+';({safeOutputChunk,LEGACY_BINARY_MARKER})');
  const valid='Thiết bị này có các quyền UTF-8';
  if(x.safeOutputChunk(valid)!==valid)throw new Error(name+'_utf8_text_changed');
  const bad='���'+String.fromCharCode(0)+'�������';
  if(x.safeOutputChunk(bad)!==x.LEGACY_BINARY_MARKER)throw new Error(name+'_legacy_binary_not_suppressed');
}

for(const token of ["import { StringDecoder } from 'node:string_decoder';",'function likelyBinaryBytes(value)','function flushOutputStates(job)','state.decoder.write(buf)']){
  if(!executor.includes(token))throw new Error('executor_output_contract_missing:'+token);
}

console.log('v11-output-utf8-split=PASS');
console.log('v11-output-binary-suppression=PASS');
console.log('v11-output-legacy-wall-sanitizer=PASS');
