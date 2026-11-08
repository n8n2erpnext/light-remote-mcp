import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativeDesktopBridge} from '../../lib/native-desktop.mjs';

class FakeStream extends EventEmitter{
  setEncoding(){return this;}
}
class FakeChild extends EventEmitter{
  constructor(name){
    super();
    this.name=name;
    this.stderr=new FakeStream();
    this.exitCode=null;
    this.killed=false;
  }
  kill(){
    this.killed=true;
    if(this.exitCode==null)this.exitCode=0;
    return true;
  }
}
class FakeSocket extends EventEmitter{
  constructor(name){
    super();
    this.name=name;
    this.destroyed=false;
    this.writes=[];
  }
  setEncoding(){return this;}
  write(data){this.writes.push(String(data));return true;}
  end(){return true;}
  destroy(){this.destroyed=true;return this;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function staleLifecycleDoesNotPoisonReplacement(){
  const children=[];
  const sockets=[];
  const bridge=new NativeDesktopBridge({
    command:'fake-rmv2.exe',
    idleMs:600000,
    spawnImpl:()=>{
      const child=new FakeChild('child-'+(children.length+1));
      children.push(child);
      return child;
    }
  });
  bridge._connectPipe=async()=>{
    const socket=new FakeSocket('socket-'+(sockets.length+1));
    sockets.push(socket);
    return socket;
  };

  const start1=bridge._start();
  while(sockets.length<1)await tick();
  bridge._onData(JSON.stringify({type:'event',eventName:'robot.ready'})+'\n');
  await start1;
  const child1=children[0];
  const socket1=sockets[0];
  assert.equal(bridge.child,child1);
  assert.equal(bridge.socket,socket1);
  assert.equal(bridge.ready,true);

  bridge.close();
  const start2=bridge._start();
  while(children.length<2||sockets.length<2)await tick();
  const child2=children[1];
  const socket2=sockets[1];
  while(bridge.socket!==socket2)await tick();

  child1.exitCode=0;
  child1.emit('exit',0,null);
  socket1.emit('close');
  socket1.emit('error',new Error('stale-socket-error'));

  assert.equal(bridge.child,child2);
  assert.equal(bridge.socket,socket2);
  assert.equal(bridge.ready,false);

  bridge._onData(JSON.stringify({type:'event',eventName:'robot.ready'})+'\n');
  await start2;
  assert.equal(bridge.child,child2);
  assert.equal(bridge.socket,socket2);
  assert.equal(bridge.ready,true);
  bridge.close();
}

async function earlyHelperExitIsHandledImmediately(){
  const children=[];
  let releasePipe;
  const bridge=new NativeDesktopBridge({
    command:'fake-rmv2.exe',
    idleMs:600000,
    spawnImpl:()=>{
      const child=new FakeChild('early-child');
      children.push(child);
      return child;
    }
  });
  bridge._connectPipe=()=>new Promise(resolve=>{
    releasePipe=()=>resolve(new FakeSocket('late-socket'));
  });

  let unhandled=null;
  const onUnhandled=reason=>{unhandled=reason;};
  process.once('unhandledRejection',onUnhandled);
  const start=bridge._start();
  while(children.length<1||!releasePipe)await tick();

  const child=children[0];
  child.exitCode=0;
  child.emit('exit',0,null);
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(unhandled,null,'startup rejection must be handled immediately');

  releasePipe();
  let rejected=false;
  try{await start;}catch(error){rejected=error?.message==='real_remote_helper_exited';}
  assert.equal(rejected,true,'startup should still report helper exit to its caller');
  process.removeListener('unhandledRejection',onUnhandled);
  bridge.close();
}

await staleLifecycleDoesNotPoisonReplacement();
await earlyHelperExitIsHandledImmediately();
console.log('RMV2_HELPER_LIFECYCLE_REGRESSION=PASS');
