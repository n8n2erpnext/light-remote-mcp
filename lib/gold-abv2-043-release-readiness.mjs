/**
 * Gold ABv2 migration043 independent release preflight.
 * Read-only policy. No environment variable, caller-provided booleans, or
 * synthetic test result can authorize a live migration.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LOCKED_PREFIX=Object.freeze([
 [40,'040_gold_connection_job_gc_fences.sql'],
 [41,'041_gold_device_execution_epoch.sql'],
 [42,'042_gold_wall_announcements_channel.sql']
]);
export const ABV2_043_LOCK_FILE='043_gold_device_short_ids.sql';
export function candidate043ManifestReview({sqlRoot}){
 const manifest=JSON.parse(fs.readFileSync(path.join(sqlRoot,'migrations.lock.json'),'utf8'));
 if(manifest.target!=='light_remote_gold_dev - independent Gold only'||
   manifest.migrations?.length!==42||
   manifest.migrations.some((e,i)=>e.version!==i+1))
  throw Error('abv2_043_manifest_unexpected_state');
 for(const [n,file] of LOCKED_PREFIX){
  const entry=manifest.migrations[n-1],body=fs.readFileSync(path.join(sqlRoot,file));
  if(entry.file!==file||entry.sha256!==crypto.createHash('sha256').update(body).digest('hex'))
   throw Error('abv2_043_parent_migration_digest_mismatch');
 }
 const file=path.join(sqlRoot,ABV2_043_LOCK_FILE);
 const source=fs.readFileSync(file,'utf8');
 if(!/^\s*(?:--[^\n]*\n\s*)*BEGIN;[\s\S]*?COMMIT;\s*$/.test(source))
  throw Error('abv2_043_source_not_transactional');
 if(!source.includes('lr_gold_short_id_immutable_trg')||
    !source.includes('ON DELETE SET NULL')||
    !source.includes('GRANT SELECT,INSERT ON lr_gold_device_short_ids TO lr_gold_app'))
  throw Error('abv2_043_source_contract_missing');
 return Object.freeze({lockedThrough:42,release043Registered:false,
  candidate043Sha256:crypto.createHash('sha256').update(source).digest('hex')});
}
export function evaluateAbv2043UatReadiness({
 manifest,db,services,backup,ownerApproval,realAgentE2E
}={}){
 if(manifest?.lockedThrough!==42||manifest?.release043Registered!==false||
    !/^[0-9a-f]{64}$/.test(manifest.candidate043Sha256||''))
  throw Error('abv2_043_invalid_manifest_review');
 const reasons=[];
 if(db?.migrationCount!==39||db?.version!==39||
    db?.shortIdAbsent!==true||db?.guestAbsent!==true)
  reasons.push('uat_schema_039_no_043_required_for_rehearsal');
 if(services?.everyActive!==true)reasons.push('gold_four_services_health_not_verified');
 if(backup?.snapshotPresent!==true||backup?.pgDumpChecksumVerified!==true)
  reasons.push('rollback_preimage_not_verified');
 // This release is intentionally staged; 040-042 production promotion,
 // owner-approved 043 registration and an independently approved migrator
 // are NOT implied by the successful offline schema-only rehearsal.
 reasons.push('043_not_registered_in_signed_migration_lock');
 reasons.push('production_migrator_still_pinned_through_042');
 if(ownerApproval?.approved!==true)
  reasons.push('owner_043_release_approval_missing');
 if(realAgentE2E?.signedOwnerWallToHelper24hLease!==true)
  reasons.push('physical_signed_owner_wall_agent_lease_e2e_missing');
 return Object.freeze({status:'HOLD_NO_UAT_CHANGE',canApply:false,
  canEnableGuest:false,candidate043Sha256:manifest.candidate043Sha256,
  reasons:Object.freeze(reasons)});
}
