#!/usr/bin/env node
// Owner-launched macOS Real Remote AX input canary.
// Changes ONLY the text field in a unique temporary osascript dialog.
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const sock=process.argv[2];
assert.ok(sock?.startsWith('/tmp/lightremote-rmv2-') && sock.endsWith('.sock'));
const runId=crypto.randomBytes(7).toString('hex');
const title='LR_Mac_AX_Canary_'+runId;
const value='LIGHT_REMOTE_TEST_'+runId;
const script='display dialog "Light Remote semantic input canary; temporary test window." default answer "" buttons {"Cancel", "OK"} default button "OK" with title "'+title+'" giving up after 24';
let child, socket, recv='', counter=0, appleOut='', appleErr='', done, connected=false;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const pending=new Map();
function request(op,args={}){
  const id='act_'+(++counter);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(op+'_timeout'));},6500);
    pending.set(id,{resolve,reject,timer});
    socket.write(JSON.stringify({id,op,...args})+'\n');
  });
}
function parse(chunk){
  recv+=chunk;
  while(recv.includes('\n')){
    const i=recv.indexOf('\n'),line=recv.slice(0,i);
    recv=recv.slice(i+1);if(!line)continue;
    const m=JSON.parse(line);if(m.type!=='response')continue;
    const p=pending.get(m.id);if(!p)continue;
    pending.delete(m.id);clearTimeout(p.timer);
    if(m.ok===false)p.reject(new Error(String(m.error||'native_error')));
    else p.resolve(m.data);
  }
}
function selectCanary(snapshot){
  const nodes=snapshot?.nodes||[];
  const matches=nodes.filter(n=>String(n.name||'').includes(title));
  const fields=nodes.filter(n=>n.role==='AXTextField'&&n.enabled===true&&n.password!==true);
  const buttons=nodes.filter(n=>n.role==='AXButton'&&n.enabled===true&&String(n.name||'').trim()==='OK');
  assert.equal(matches.length,1,'unique canary title missing');
  assert.equal(fields.length,1,'unique safe AXTextField missing');
  assert.equal(buttons.length,1,'unique OK button missing');
  return {field:fields[0],button:buttons[0]};
}
async function main(){
  for(let i=0;i<60;i++){
    try{socket=await new Promise((res,rej)=>{
      const s=net.createConnection(sock);s.once('connect',()=>res(s));s.once('error',rej);
    });connected=true;break;}catch(e){if(i===59)throw e;await wait(100);}
  }
  socket.setEncoding('utf8');socket.on('data',parse);
  const status=await request('desktop.status');
  assert.equal(status.accessibility,true,'Accessibility not granted in GUI test');
  child=spawn('/usr/bin/osascript',['-e',script],{stdio:['ignore','pipe','pipe']});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',s=>{appleOut+=s;});
  child.stderr.on('data',s=>{appleErr+=s;});
  done=new Promise(res=>child.once('exit',code=>res(code)));
  await wait(1500);
  let session, targets, seen=false;
  for(let i=0;i<5;i++){
    session=await request('desktop.semantic.attach',{scope:'foreground',maxDepth:8,maxNodes:300});
    const appName=String(session.rootTitle||'').toLowerCase();
    try{
      assert.ok(appName.includes('osascript'),'foreground must be isolated osascript dialog');
      targets=selectCanary(session.snapshot);
      seen=true;break;
    }catch(e){
      await request('desktop.semantic.detach',{semanticSessionId:session.semanticSessionId});
      session=null;
      if(i===4)throw e;
      await wait(300);
    }
  }
  assert.ok(seen);
  console.log('isolated_dialog_guard=PASS');
  try{
    // Do not activate or type into unrelated windows.
    const fresh=await request('desktop.semantic.snapshot',{semanticSessionId:session.semanticSessionId});
    targets=selectCanary(fresh.snapshot);
    await request('desktop.semantic.act',{semanticSessionId:session.semanticSessionId,nodeId:targets.field.nodeId,action:'value',value});
    console.log('ax_textfield_setvalue=PASS');
    const next=await request('desktop.semantic.snapshot',{semanticSessionId:session.semanticSessionId});
    targets=selectCanary(next.snapshot);
    await request('desktop.semantic.act',{semanticSessionId:session.semanticSessionId,nodeId:targets.button.nodeId,action:'invoke'});
    console.log('ax_ok_button_invoke=PASS');
    const exit=await Promise.race([done,wait(5000).then(()=>{throw new Error('dialog_result_timeout')})]);
    assert.equal(exit,0,'dialog did not return success');
    assert.ok(appleOut.includes('button returned:OK'),'canary not confirmed');
    assert.ok(appleOut.includes('text returned:'+value),'synthetic field mismatch');
    console.log('synthetic_value_roundtrip=PASS');
    console.log('OWNER_MACOS_AX_INPUT_E2E=PASS');
  }finally{
    if(session){try{await request('desktop.semantic.detach',{semanticSessionId:session.semanticSessionId});}catch{}}
  }
}
try{await main();}catch(e){console.error('OWNER_MACOS_AX_INPUT_E2E=FAIL '+e.message);process.exitCode=1;}
finally{
  if(child?.exitCode==null){try{child.kill('SIGTERM');}catch{}}
  for(const p of pending.values()){clearTimeout(p.timer);}
  pending.clear();socket?.destroy();
}
