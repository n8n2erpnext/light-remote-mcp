import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {WALL_VIDEO_SCRIPT} from '../../../device-agent/wall-video-viewer.mjs';
const [fixtureFile,receiptFile]=process.argv.slice(2);
const fixture=JSON.parse(await fs.readFile(fixtureFile,'utf8'));
assert.equal(fixture.result,'ENCODED_BROWSER_DECODE_REQUIRED');assert.equal(fixture.frames.length,16);
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/decoder'){res.setHeader('content-type','text/javascript');return res.end(WALL_VIDEO_SCRIPT);}
 res.setHeader('content-type','text/html');res.end('<!doctype html><title>CI synthetic decoder</title><canvas id="fixture" width="128" height="96"></canvas>');
});server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 const proof=await page.evaluate(async frames=>{
  const {IndependentH264Viewer}=await import('/decoder');let failure;
  const canvas=document.getElementById('fixture');const viewer=new IndependentH264Viewer(canvas,error=>failure=error.message);const samples=[];
  for(const frame of frames){
   await viewer.push(frame);await viewer.flush();
   if(failure)throw Error(failure);
   const color=[...canvas.getContext('2d').getImageData(10,10,1,1).data];
   const expected=frame.expectedColor==='red'?[255,0,0]:[0,0,255];
   if(expected.some((value,index)=>Math.abs(value-color[index])>40))throw Error('Decoded color mismatch '+JSON.stringify({expected,color}));
   samples.push({expectedColor:frame.expectedColor,color,hardwareEncoding:frame.hardwareEncoding,encoderBackend:frame.encoderBackend});
  }
  const count=viewer.decoded;viewer.clear();if(!canvas.hidden)throw Error('Cleared video still visible');viewer.close();
  return {decoded:count,samples,clearHidesVideo:true};
 },fixture.frames);
 assert.equal(proof.decoded,16);
 const receipt=JSON.parse(await fs.readFile(receiptFile,'utf8'));assert.equal(receipt.result,'NATIVE_PASS_BROWSER_DECODE_PENDING');
 Object.assign(receipt,{result:'PASS',browserDecoder:'same-production-WebCodecs-viewer',browserDecode:proof,syntheticFixtureOnly:true});
 await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({result:'PASS',decoded:proof.decoded,softwareAndHardwarePreference:true,physicalOwnerAcceptance:false}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
