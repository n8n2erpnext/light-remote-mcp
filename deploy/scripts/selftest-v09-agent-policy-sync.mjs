import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { deviceChannelMessage, devicePolicyMessage } from '../../lib/device-proof.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-v09-policy-sync-')),stateFile=path.join(dir,'device.json'),commandDir=path.join(dir,'commands');
const cli=new URL('../../device-agent/operator-agent.mjs',import.meta.url).pathname;
const deviceKeys=crypto.generateKeyPairSync('ed25519'),signerKeys=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=deviceKeys.publicKey.export({format:'der',type:'spki'}).toString('base64'),signerPublic=signerKeys.publicKey.export({format:'der',type:'spki'}).toString('base64');
const deviceId='dev_abcdef1234567890abcdef12',accountId='self-hosted-local';
const state={identity:{algorithm:'Ed25519',privateKey:deviceKeys.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicIdentityKey},enrollment:{deviceId,nodeId:deviceId,accountId,grantableCapabilities:['filesystem','git','sudo-on-demand'],approvedCapabilities:['filesystem','git','sudo-on-demand'],policyProfile:'ops',signer:{algorithm:'Ed25519',publicKey:signerPublic}},policy:{deniedCapabilities:[],serverPolicyRevision:1,localFinalDenyBoundary:true}};
fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
const policy={deviceId,accountId,policyProfile:'standard',policyRevision:2,policyUpdatedAt:1_900_000_001_000,grantableCapabilities:['filesystem','git','sudo-on-demand'],approvedCapabilities:['filesystem','git']};
const signature=crypto.sign(null,Buffer.from(devicePolicyMessage({deviceId,accountId,revision:2,approvedCapabilities:policy.approvedCapabilities,grantableCapabilities:policy.grantableCapabilities,policyProfile:policy.policyProfile,updatedAt:policy.policyUpdatedAt})),signerKeys.privateKey).toString('base64url');
const envelope={policy,signature,signer:{algorithm:'Ed25519',publicKey:signerPublic}};
const command={commandId:'cmd_v09policysync1234567890',payload:{type:'exec',operationId:'op-v09-policy-sync',script:'sudo -n true',cwd:dir,timeoutMs:5000,requiredCapabilities:['filesystem']}};
let pollCount=0;const revisions=[],results=[];
function send(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function verify(action,body){const message=deviceChannelMessage({deviceId:body.deviceId,action,timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});return crypto.verify(null,Buffer.from(message),deviceKeys.publicKey,Buffer.from(body.signature,'base64url'));}
const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url==='/device-channel/poll'){if(!verify('poll',body))return send(res,401,{ok:false,error:'bad_signature'});revisions.push(Number(body.payload?.policyRevision)||0);const first=pollCount++===0;return send(res,200,{ok:true,channel:{node:{state:'online',draining:false},state:first?'command':'idle',command:first?command:null},policy:first?envelope:null});}
  if(req.url==='/device-channel/result'){if(!verify('result',body))return send(res,401,{ok:false,error:'bad_signature'});results.push(body.payload);return send(res,200,{ok:true,accepted:true});}
  return send(res,404,{ok:false,error:'not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const hub=`http://127.0.0.1:${server.address().port}`;
const child=spawn(process.execPath,[cli,'daemon'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_COMMAND_DIR:commandDir,OPERATOR_AGENT_HUB_URL:hub,OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000'},stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',c=>stderr+=c);
const deadline=Date.now()+8000;while((results.length<1||revisions.length<2)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
child.kill('SIGTERM');const exitCode=await new Promise(resolve=>child.on('exit',resolve));
if(exitCode!==0)throw new Error(`daemon_failed:${exitCode}:${stderr}`);
if(results.length!==1)throw new Error(`result_count:${results.length}`);
if(revisions[0]!==1||!revisions.slice(1).includes(2))throw new Error(`policy_revision_not_advertised:${revisions.join(',')}`);
const result=results[0];
if(result.exitCode!==126||!/local capability denied: sudo-on-demand/.test(result.stderr||''))throw new Error(`policy_not_applied_before_command:${JSON.stringify(result)}`);
const persisted=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(persisted.policy?.serverPolicyRevision!==2||persisted.enrollment?.approvedCapabilities?.includes('sudo-on-demand')||!persisted.enrollment?.grantableCapabilities?.includes('sudo-on-demand'))throw new Error('policy_state_not_persisted');
console.log('v09-agent-signed-policy-sync=PASS');
console.log('v09-agent-policy-before-command=PASS');
console.log('v09-agent-policy-revision-advertise=PASS');
server.close();fs.rmSync(dir,{recursive:true,force:true});
