import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { NativeSearchRegistry } from '../../lib/native-search.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-search-'));
fs.mkdirSync(path.join(root,'src'),{recursive:true});
fs.writeFileSync(path.join(root,'src','a.js'),'alpha\nNeedle here\nomega\n');
fs.writeFileSync(path.join(root,'src','b.txt'),'needle lower\nsecond\n');
fs.writeFileSync(path.join(root,'README.md'),'No match\n');
const owner={accountId:'acct-search',deviceId:'dev-search',sessionId:'session-search-0001',agentId:'agent-search-selftest-0001'};
const other={...owner,agentId:'agent-search-selftest-0002'};
const reg=new NativeSearchRegistry();
const wait=async id=>{for(let i=0;i<100;i++){const v=reg.results(id,owner,{limit:100});if(v.finishedAt)return v;await new Promise(r=>setTimeout(r,5));}throw new Error('search_timeout');};
let s=await reg.start({...owner,path:root,searchType:'content',pattern:'needle',literalSearch:true,ignoreCase:true,filePattern:'*.js|*.txt',contextLines:1,maxResults:20,readRoots:[root]});
assert.ok(s.searchId.startsWith('ls_'));
let r=await wait(s.searchId);
assert.equal(r.state,'finished');
assert.equal(r.resultCount,2);
assert.ok(r.results.some(x=>x.relativePath==='src/a.js'&&x.lineNumber===2&&x.before[0]==='alpha'));
assert.ok(r.results.some(x=>x.relativePath==='src/b.txt'&&x.lineNumber===1));
const page=reg.results(s.searchId,owner,{offset:1,limit:1});
assert.equal(page.returned,1);assert.equal(page.nextOffset,2);
assert.throws(()=>reg.results(s.searchId,other),/search_owner_mismatch/);
s=await reg.start({...owner,path:root,searchType:'files',pattern:'\\.md$',literalSearch:false,ignoreCase:true,maxResults:10,readRoots:[root]});
r=await wait(s.searchId);assert.equal(r.resultCount,1);assert.equal(r.results[0].relativePath,'README.md');
let denied=false;try{await reg.start({...owner,path:'/etc',searchType:'files',pattern:'hosts',literalSearch:true,readRoots:[root]});}catch(e){denied=e.status===403;}
assert.ok(denied,'search_root_boundary_failed');
s=await reg.start({...owner,path:root,searchType:'content',pattern:'a',literalSearch:true,maxResults:100,readRoots:[root]});
reg.cancel(s.searchId,owner);r=await wait(s.searchId);assert.equal(r.state,'cancelled');
fs.rmSync(root,{recursive:true,force:true});
console.log('v10-native-search-content-files=PASS');
console.log('v10-native-search-pagination-boundary=PASS');
console.log('v10-native-search-cancel-owner=PASS');

const executor=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
for(const token of ["kind:'search'","kind:'process'","kind:'scp'",'searchActivityMeta(request)','processActivityMeta(request)','scpActivityMeta(request)'])if(!executor.includes(token))throw new Error('native_activity_meta_missing:'+token);
console.log('v10-native-activity-wall-meta=PASS');
