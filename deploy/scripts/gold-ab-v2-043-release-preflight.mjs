#!/usr/bin/env node
/**
 * Read-only PRIVATE Gold UAT release readiness check. It NEVER has --apply.
 * No service env vars, customer rows, identities or secrets are emitted.
 */
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidate043ManifestReview,evaluateAbv2043UatReadiness}
 from '../../lib/gold-abv2-043-release-readiness.mjs';

if(process.argv.length!==2&&!(process.argv.length===3&&process.argv[2]==='--preflight')){
 console.error('ABV2_043_PREFLIGHT_READ_ONLY_NO_APPLY');process.exit(2);
}
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=candidate043ManifestReview({sqlRoot:path.join(root,'platform-v2/sql')});
const run=(bin,args)=>execFileSync(bin,args,{timeout:12000,encoding:'utf8',
 maxBuffer:1024*128}).trim();
const states=run('lxc',['list','--format=csv','-c','ns']).split('\n');
const uat='light-remote-gold-uat';
if(!states.includes(uat+',RUNNING'))throw Error('abv2_043_uat_not_running');
const sql="SELECT count(*),max(version),to_regclass('public.lr_gold_device_short_ids') IS NULL,to_regclass('public.lr_gold_pro_share_guest_jobs') IS NULL FROM public.lr_schema_migrations";
const row=run('lxc',['exec',uat,'--','runuser','-u','postgres','--','psql','-X','-At','-d','light_remote_gold_dev','-c',sql]).split('|');
const units=['light-remote-gold-operator','light-remote-gold-plugin','light-remote-gold-wall','light-remote-gold-process-supervisor'];
const active=run('lxc',['exec',uat,'--','sh','-c',
 'for s in light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall light-remote-gold-process-supervisor;do systemctl is-active "$s";done']).split('\n');
// LXC 6.10 provides snapshots in `lxc info <instance>`; `lxc snapshot list`
// is not a supported subcommand. Match an exact snapshot row, not prose.
const snapshotInfo=run('lxc',['info',uat]);
const hasSnapshot=/^\|\s*pre-p2-final-gate-20261031\s*\|/m.test(snapshotInfo);
const backupDir='/home/ubuntu/handoffs/gold-p2-rollback-20261031';
let validChecksum=false;
try{run('sha256sum',['-c',path.join(backupDir,'pgdump.sha256')]);validChecksum=true;}catch{}
const result=evaluateAbv2043UatReadiness({
 manifest,db:{migrationCount:Number(row[0]),version:Number(row[1]),
 shortIdAbsent:row[2]==='t',guestAbsent:row[3]==='t'},
 services:{everyActive:active.length===units.length&&active.every(x=>x==='active')},
 backup:{snapshotPresent:hasSnapshot,pgDumpChecksumVerified:validChecksum},
 // These must come from separate reviewed durable real-world evidence.
 ownerApproval:null,realAgentE2E:null
});
console.log(JSON.stringify({ ...result,uatMigration:Number(row[1]),
 unitsActive:active.filter(x=>x==='active').length,
 verifiedSnapshot:hasSnapshot,verifiedPgDump:validChecksum,
 guestSchemaAbsent:row[3]==='t'},null,2));
if(result.status!=='HOLD_NO_UAT_CHANGE'||result.canApply!==false)
 process.exitCode=4;
