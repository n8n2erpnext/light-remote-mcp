/* Explicit local broker launcher. No untrusted network bind.
 * bootstrap reads JSON {password} on stdin: no argv/env secret exposure. */
import {pathToFileURL} from 'node:url';
import {bootstrapOwnerBroker,startOwnerBroker,ownerBrokerRequest} from './project-continuity-owner-broker.mjs';
import path from 'node:path';

const arg=(name)=>{const idx=process.argv.indexOf(name);return idx<0?null:process.argv[idx+1];};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const command=process.argv[2],runtimeDir=arg('--root');
 if(!runtimeDir||!path.isAbsolute(runtimeDir))throw Error('continuity_broker_root_required');
 if(command==='bootstrap'){
  let text='';
  for await(const chunk of process.stdin){
   text+=chunk.toString('utf8');
   if(text.length>2048)throw Error('continuity_broker_input_too_large');
  }
  const parsed=JSON.parse(text);
  bootstrapOwnerBroker({runtimeDir,password:parsed.password});
  process.stdout.write('CONTINUITY_OWNER_BROKER_INITIALIZED\\n');
 }else if(command==='serve'){
  const broker=startOwnerBroker({runtimeDir,clientGroupMode:process.platform==='win32'?0o600:0o660});
  const stop=()=>broker.stop().then(()=>process.exit(0)).catch(()=>process.exit(1));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }else if(command==='health'){
  ownerBrokerRequest({runtimeDir,action:'health'}).then(result=>console.log(JSON.stringify(result)))
   .catch(error=>{console.error(error.message);process.exitCode=1;});
 }else{
  console.error('usage: owner-broker-cli.mjs bootstrap|serve|health --root DIR');
  process.exitCode=2;
 }
}
