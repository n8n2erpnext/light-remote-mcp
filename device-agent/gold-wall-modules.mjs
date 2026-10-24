/*
 * Optional Gold Wall modules. Local owner-scoped SQLite.
 * No secondary Wall, server, Account, mandatory Project, or old Continuity code.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createGoldCodexConnection} from './gold-codex-api.mjs';
import {createGoldCodexPlus} from './gold-codex-plus.mjs';
import {saveGoldCheckpoint,readGoldCheckpoint,listGoldCheckpoints,goldHandoff,saveGoldObserverReceipt,listGoldObserverReceipts,confirmGoldObserverTask} from './gold-memory-ledger.mjs';
const loadBuiltin=createRequire(import.meta.url);

function fault(code,status=400){return Object.assign(new Error(code),{status});}
function strictText(input,max,code){
  if(typeof input!=='string'||!input.trim()||input.length>max)throw fault(code);
  return input.trim();
}
function openPrivate(file){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(fs.existsSync(file)&&(fs.statSync(file).mode&0o077))throw fault('gold_modules_database_permissions',503);
  const {DatabaseSync}=loadBuiltin('node:sqlite'); // do not activate SQLite while modules are OFF
  const db=new DatabaseSync(file);
  try {
    fs.chmodSync(file,0o600);
    db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=2500;');
    db.exec('CREATE TABLE IF NOT EXISTS module_flags (singleton INTEGER PRIMARY KEY CHECK(singleton=1), memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK(memory_enabled IN (0,1)),codex_enabled INTEGER NOT NULL DEFAULT 0 CHECK(codex_enabled IN (0,1)),revision INTEGER NOT NULL DEFAULT 0);'
      +'CREATE TABLE IF NOT EXISTS owner_notes(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN (\'note\',\'decision\',\'checkpoint\')),body TEXT NOT NULL,source TEXT NOT NULL,created_ms INTEGER NOT NULL);'
      +'CREATE TABLE IF NOT EXISTS observer_tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (\'todo\',\'working\',\'done\',\'waiting\')),created_ms INTEGER NOT NULL,changed_ms INTEGER NOT NULL);'
      +'INSERT OR IGNORE INTO module_flags(singleton) VALUES(1);');
  }catch(e){db.close();throw e;}
  return db;
}
export function createGoldWallModules({file,fetchImpl,plusImpl}){
  if(!path.isAbsolute(file))throw fault('gold_modules_storage_path_required');
  let database=null;
  let codexRequestInFlight=false;
  const codex=createGoldCodexConnection({storageFile:file+'.codex.enc',fetchImpl});
  const plus=plusImpl||createGoldCodexPlus({home:path.join(path.dirname(file),'codex-home')});
  const checkpointKeyFile=file+'.checkpoint-key';
  function open(create=false){
    if(database)return database;
    if(!create&&!fs.existsSync(file))return null;
    database=openPrivate(file);return database;
  }
  function flags(){
    const db=open();
    if(!db)return {longMemory:false,codexBridge:false,revision:0};
    const r=db.prepare('SELECT memory_enabled,codex_enabled,revision FROM module_flags WHERE singleton=1').get();
    return {longMemory:r?.memory_enabled===1,codexBridge:r?.codex_enabled===1,revision:Number(r?.revision)||0};
  }
  function enabled(feature){
    if(!flags()[feature])throw fault('gold_module_disabled',409);
    return open();
  }
  return {
    flags,
    configure(input={}){
      if(typeof input.longMemory!=='boolean'||typeof input.codexBridge!=='boolean'
        ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)
        throw fault('gold_modules_configuration_invalid');
      if(!fs.existsSync(file)&&!input.longMemory&&!input.codexBridge&&input.expectedRevision===0)
        return flags(); // OFF/OFF creates no database.
      const db=open(true);
      const result=db.prepare('UPDATE module_flags SET memory_enabled=?,codex_enabled=?,revision=revision+1 WHERE singleton=1 AND revision=?')
        .run(Number(input.longMemory),Number(input.codexBridge),input.expectedRevision);
      if(result.changes!==1)throw fault('gold_modules_revision_conflict',409);
      return flags();
    },
    saveCheckpoint(input={}){return saveGoldCheckpoint(enabled('longMemory'),checkpointKeyFile,input);},
    readCheckpoint(id){return readGoldCheckpoint(enabled('longMemory'),checkpointKeyFile,id);},
    listCheckpoints(input={}){return listGoldCheckpoints(enabled('longMemory'),checkpointKeyFile,input);},
    handoff(input={}){return goldHandoff(enabled('longMemory'),checkpointKeyFile,input);},
    observerReceipts(){return listGoldObserverReceipts(enabled('codexBridge'));},
    confirmObserverTask(input={}){return confirmGoldObserverTask(enabled('codexBridge'),input);},
    saveNote(input={}){
      const db=enabled('longMemory');
      if(!['note','decision','checkpoint'].includes(input.kind??'note'))throw fault('gold_memory_kind_invalid');
      const kind=input.kind??'note',body=strictText(input.body,12000,'gold_memory_body_invalid'),
        source=strictText(input.source,512,'gold_memory_source_required');
      const id=crypto.randomUUID(),createdAt=Date.now();
      db.prepare('INSERT INTO owner_notes(id,kind,body,source,created_ms) VALUES(?,?,?,?,?)').run(id,kind,body,source,createdAt);
      return {id,kind,source,createdAt};
    },
    notes({query='',limit=20}={}){
      const db=enabled('longMemory');
      if(typeof query!=='string'||query.length>160)throw fault('gold_memory_query_invalid');
      const n=Math.min(Math.max(Number(limit)||20,1),50);
      if(query.trim()){
        const q='%'+query.trim().replace(/[\\%_]/g,'\\$&')+'%';
        return db.prepare("SELECT id,kind,body,source,created_ms AS createdAt FROM owner_notes WHERE body LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' ORDER BY created_ms DESC,id DESC LIMIT ?").all(q,q,n);
      }
      return db.prepare('SELECT id,kind,body,source,created_ms AS createdAt FROM owner_notes ORDER BY created_ms DESC,id DESC LIMIT ?').all(n);
    },
    addTask(input={}){
      const db=enabled('codexBridge');
      const title=strictText(input.title,240,'gold_observer_task_invalid');
      const id=crypto.randomUUID(),now=Date.now();
      db.prepare('INSERT INTO observer_tasks(id,title,state,created_ms,changed_ms) VALUES(?,?,?,?,?)').run(id,title,'todo',now,now);
      return {id,title,state:'todo'};
    },
    updateTask(input={}){
      const db=enabled('codexBridge');
      const id=strictText(input.id,64,'gold_observer_task_id_invalid');
      if(!['todo','working','done','waiting'].includes(input.state))throw fault('gold_observer_state_invalid');
      const result=db.prepare('UPDATE observer_tasks SET state=?,changed_ms=? WHERE id=?').run(input.state,Date.now(),id);
      if(result.changes!==1)throw fault('gold_observer_task_not_found',404);
      return {id,state:input.state};
    },
    async codexPlusStatus(){enabled('codexBridge');return plus.account();},
    async codexPlusLogin(){enabled('codexBridge');return plus.beginLogin();},
    async codexPlusCancel(){enabled('codexBridge');return plus.cancelLogin();},
    async codexPlusLogout(){enabled('codexBridge');return plus.logout();},
    async codexPlusObserve(){
      const db=enabled('codexBridge');
      if(codexRequestInFlight)throw fault('codex_run_already_in_progress',409);
      codexRequestInFlight=true;
      try{
        const rows=db.prepare('SELECT id,title,state,changed_ms AS changedAt FROM observer_tasks ORDER BY changed_ms DESC LIMIT 20').all();
        const result=await plus.runReadOnly({tasks:rows});
        if(result.completed&&typeof result.summary==='string'&&result.summary.trim()){
          const receipt=saveGoldObserverReceipt(db,{summary:result.summary,status:'completed',tasks:rows});
          return {...result,receipt,taskStateChanged:false,ownerConfirmationRequired:true};
        }
        return {...result,taskStateChanged:false,ownerConfirmationRequired:true};
      }finally{codexRequestInFlight=false;}
    },
    codexConfig(){enabled('codexBridge');return codex.config();},
    saveCodexKey(input){enabled('codexBridge');return codex.save(input);},
    clearCodexKey(){enabled('codexBridge');return codex.clear();},
    async verifyCodexKey(){enabled('codexBridge');return codex.verify();},
    async runCodexObserver(){
      const db=enabled('codexBridge');
      if(codexRequestInFlight)throw fault('codex_run_already_in_progress',409);
      codexRequestInFlight=true;
      try {
        const tasks=db.prepare('SELECT title,state FROM observer_tasks ORDER BY changed_ms DESC LIMIT 20').all();
        return await codex.run({tasks});
      } finally {codexRequestInFlight=false;}
    },
    observer(){
      const db=enabled('codexBridge');
      const tasks=db.prepare('SELECT id,title,state,created_ms AS createdAt,changed_ms AS changedAt FROM observer_tasks ORDER BY created_ms,id LIMIT 100').all();
      const states=tasks.map(t=>t.state);
      const recommendation=states.includes('waiting')?'WAIT_OWNER'
        :states.length>0&&states.every(s=>s==='done')?'DONE'
        :states.some(s=>s==='working'||s==='todo')?'CONTINUE':'WAIT_OWNER';
      return {tasks,recommendation,engine:'local-controller',codexRuntime:'not_connected',webTurnContinuation:'unsupported'};
    },
    close(){plus.stop();if(database){database.close();database=null;}}
  };
}
