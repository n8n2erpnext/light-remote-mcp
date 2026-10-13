/**
 * rc50 synthetic-only isolated PostgreSQL reader + Ed25519 verifier.
 * NO real Local Wall, OS effects, or production trust. No signing key.
 * Only reads signedPackets from stdin; NEVER accepts external trusted context.
 */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verifySyntheticOwnerChannelEnvelope} from './synthetic-owner-channel-verify-only.mjs';

const ID=/^uat_[A-Za-z0-9_-]{4,90}$/;
const HEX=/^[a-f0-9]{64}$/;
const deny=(reason)=>({decision:'DENY',reason,
  physicalExecutionAuthorized:false,productionIssuerAuthorized:false});

function readDbContext(envelope){
  const request=envelope?.wallApproval?.payload?.requestId;
  const nonce=envelope?.wallApproval?.payload?.wallDecisionNonceSha256;
  if(!ID.test(request??'')||!HEX.test(nonce??''))throw Error('INVALID_LOOKUP_ID');
  const secret=fs.readFileSync('/tmp/lr_rc50_origin_reader_secret','utf8');
  if(secret.length<25||secret.length>128)throw Error('INVALID_DB_SECRET');
  const sql=`SELECT public.lr_uat_get_owner_channel_context('${request}','${nonce}')::text`;
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',PGPASSWORD:secret,
     PGCONNECT_TIMEOUT:'3',PGSSLMODE:'disable'};
  // Password never appears in argv, Docker metadata or returned receipt.
  // SSL is intentionally disabled only for isolated UAT; NOT a production model.
  const r=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-At',
    '-h','postgres','-p','5432','-U','lr_uat_origin_reader_login',
    '-d','light_remote_rc50_uat','-c',sql],{
      encoding:'utf8',maxBuffer:65536,timeout:5000,env
    });
  if(r.status!==0||r.error||!r.stdout?.trim())throw Error('DB_CONTEXT_UNAVAILABLE');
  const trusted=JSON.parse(r.stdout);
  if(trusted.requestId!==request)throw Error('DB_CONTEXT_BINDING_MISMATCH');
  return trusted;
}
export function verifyViaSyntheticDb(envelope) {
  try{return verifySyntheticOwnerChannelEnvelope(envelope,readDbContext(envelope));}
  catch{return deny('SYNTHETIC_CONTEXT_UNAVAILABLE');}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.slice(2).join(' ')!=='--synthetic-only'||
      process.env.LR_RC50_UAT_ONLY!=='1'){
    process.stderr.write('synthetic_verifier_explicit_optin_required\n');
    process.exit(3);
  }
  try{
    let raw='';
    for await(const chunk of process.stdin){
      raw+=chunk.toString('utf8');
      if(raw.length>24000)throw Error('MAX_INPUT');
    }
    const arg=JSON.parse(raw);
    // Strictly signed packets; a caller-supplied "trusted" object is refused.
    if(!arg||Object.keys(arg).sort().join(',')!=='envelope')
      throw Error('UNTRUSTED_CONTEXT_FORBIDDEN');
    process.stdout.write(JSON.stringify(verifyViaSyntheticDb(arg.envelope))+'\n');
  }catch{
    process.stderr.write('synthetic_verifier_input_refused\n');
    process.exitCode=4;
  }
}
