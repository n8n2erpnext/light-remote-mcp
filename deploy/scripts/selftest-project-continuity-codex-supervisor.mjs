import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {CodexAppServerClient,validateSupervisorProposal} from '../../device-agent/project-continuity-codex-rpc.mjs';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-codex-supervisor-'));
let db,client;
try{
 db=new ContinuityStore({root});
 const project=db.createProject({projectName:'Codex only',workspace:root});
 db.setModules(project.id,{memory:false,codex:true,expectedRevision:1});
 const task=db.createTask(project.id,'Task split');
 const a=db.addSection(task.id,{title:'A awaits owner'});
 const b=db.addSection(task.id,{title:'B independent'});
 const c=db.addSection(task.id,{title:'C depends on A',dependsOn:[a.id]});
 db.requestApproval(a.id,'Manual security gate');
 const snapshot=db.checkpoint(project.id);
 assert.equal(snapshot.project.memoryEnabled,false);
 const payload={projectId:project.id,sectionIds:[b.id],recommendation:'CONTINUE_SECTION_B',reason:'B is independent of A',evidenceRefs:[]};
 assert.equal(validateSupervisorProposal(snapshot,payload).status,'PROPOSED');
 assert.equal(validateSupervisorProposal(snapshot,payload).authorized,false);
 assert.throws(()=>validateSupervisorProposal(snapshot,{...payload,recommendation:'DONE'}),/continuity_codex_done_unverified/);
 assert.throws(()=>validateSupervisorProposal(snapshot,{...payload,sectionIds:[c.id]}),/continuity_codex_section_not_ready/);
 assert.throws(()=>validateSupervisorProposal(snapshot,{...payload,projectId:crypto.randomUUID()}),/continuity_codex_project_mismatch/);
 assert.equal(db.codexThread(project.id),null);

 const mock=path.join(root,'fake-app-server.mjs'),receipt=path.join(root,'declined.json');
 fs.writeFileSync(mock,[
  "import readline from 'node:readline';",
  "import fs from 'node:fs';",
  "const reader=readline.createInterface({input:process.stdin});",
  "const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');",
  "let started=false;",
  "reader.on('line',line=>{const x=JSON.parse(line);",
  "if(x.method==='initialize')send({id:x.id,result:{capabilities:{}}});",
  "else if(x.method==='thread/start') {if(x.params.sandbox!=='read-only')process.exit(12);send({id:x.id,result:{thread:{id:'thr_fake_1'}}});}",
  "else if(x.method==='thread/resume')send({id:x.id,result:{thread:{id:x.params.threadId}}});",
  "else if(x.method==='turn/start') {if(x.params.sandboxPolicy?.type!=='readOnly')process.exit(13);",
  "  if(x.params.sandboxPolicy?.access?.type!=='restricted')process.exit(14);",
  "  send({id:x.id,result:{turn:{id:'turn_fake_1'}}});",
  "  send({id:900,method:'item/commandExecution/requestApproval',params:{command:'unsafe_command'}});}",
  "else if(x.id===900){fs.writeFileSync(process.env.MOCK_DECISION_LOG,JSON.stringify(x.result));",
  "  send({method:'item/agentMessage/delta',params:{delta:process.env.MOCK_PROPOSAL}});",
  "  send({method:'turn/completed',params:{turn:{id:'turn_fake_1',status:'completed'}}});}",
  "});"
 ].join('\n'));
 client=new CodexAppServerClient({binary:process.execPath,args:[mock],cwd:root,timeoutMs:9000,
  env:{MOCK_PROPOSAL:JSON.stringify(payload),MOCK_DECISION_LOG:receipt}});
 await client.initialize();
 const threadId=await client.startSupervisorThread();
 assert.equal(await client.resumeSupervisorThread(threadId),threadId);
 db.recordCodexThread(project.id,{threadId});
 const recommendation=await client.supervise({threadId,snapshot});
 assert.deepEqual(recommendation.proposal.sectionIds,[b.id]);
 assert.equal(recommendation.proposal.recommendation,'CONTINUE_SECTION_B');
 assert.equal(recommendation.proposal.authorized,false);
 assert.deepEqual(JSON.parse(fs.readFileSync(receipt,'utf8')),{decision:'decline'});
 // Agent reasoning never alters Task Controller state.
 assert.equal(db.section(a.id).state,'WAIT_OWNER');
 assert.equal(db.section(b.id).state,'READY');
 assert.equal(db.section(c.id).state,'BLOCKED');
 await client.close();client=null;
 db.close();db=null;
 db=new ContinuityStore({root});
 assert.equal(db.codexThread(project.id).thread_id,threadId);
 assert.equal(db.project(project.id).memory_enabled,0);
 console.log('P3_CODEX_APP_SERVER_MOCK_PROTOCOL_READONLY_DENIAL_PASS');
 console.log('P3_CODEX_ONLY_THREAD_PERSISTENCE_NO_MEMORY_PASS');
}finally{
 try{await client?.close();}catch{}
 try{db?.close();}catch{}
 fs.rmSync(root,{recursive:true,force:true});
}
