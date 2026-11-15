import fs from 'node:fs';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {appendObservationImage} from './rmv2-observation-image.mjs';
import {observationTicket} from '../lib/rmv2-observation.mjs';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('observation_fixture_actions_only');
const receipt=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
// Independent PNG decoder verifies bytes AFTER the real MCP formatter. It
// does not read the producer's pixel hash or reuse its bitmap readback logic.
function decode(bytes){
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');let w,h,color,depth;const data=[];
 for(let p=8;p+12<=bytes.length;){const n=bytes.readUInt32BE(p),type=bytes.toString('ascii',p+4,p+8),body=bytes.subarray(p+8,p+8+n);if(type==='IHDR'){w=body.readUInt32BE(0);h=body.readUInt32BE(4);depth=body[8];color=body[9];}if(type==='IDAT')data.push(body);p+=12+n;}
 assert.equal(depth,8);assert.ok([2,6].includes(color));const channels=color===2?3:4,stride=w*channels,raw=inflateSync(Buffer.concat(data)),out=Buffer.alloc(stride*h);
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<h;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const a=x>=channels?out[y*stride+x-channels]:0,b=y?out[(y-1)*stride+x]:0,c=y&&x>=channels?out[(y-1)*stride+x-channels]:0;out[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return {w,h,channels,out};
}
for(const [i,row] of receipt.frames.entries()){
 const packet={epoch:'fixture-native',displayTopologyId:row.frame.displayTopologyId,frameSeq:i+1,observation:row.frame};
 const response=appendObservationImage({content:[{type:'text',text:'synthetic fixture'}]},packet,observationTicket(packet));
 assert.equal(response.content[1].type,'image');const image=decode(Buffer.from(response.content[1].data,'base64'));assert.equal(image.w,128);assert.equal(image.h,96);
 for(let y=0;y<image.h;y++)for(let x=0;x<image.w;x++){const p=(y*image.w+x)*image.channels;assert.deepEqual([...image.out.subarray(p,p+3)],x===row.expectedImageX?[255,0,0]:[255,255,255]);}
}
console.log('NATIVE_PNG_THROUGH_MCP_IMAGE=PASS; exact1px+2px RGB, synthetic fixture only');
