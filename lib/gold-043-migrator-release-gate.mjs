/** Gold native migrator: 042 remains the only currently shipped lock.
 * A future, separately reviewed 043 lock is accepted ONLY with an independent
 * explicit migrator opt-in AND Operator 043 startup approval. This function
 * does not register, approve, or apply migrations; Owner UAT authorization,
 * backup/rollback, and physical signed Agent E2E remain external gates.
 */
export function reviewGoldMigratorReleaseManifest(manifest,{env={}}={}){
 const migrations=manifest?.migrations;
 if(manifest?.target!=='light_remote_gold_dev - independent Gold only'||
    !Array.isArray(migrations)||![42,43].includes(migrations.length)||
    migrations[39]?.file!=='040_gold_connection_job_gc_fences.sql'||
    migrations[40]?.file!=='041_gold_device_execution_epoch.sql'||
    migrations[41]?.file!=='042_gold_wall_announcements_channel.sql')
  throw Error('gold_migration_manifest_not_verified');
 if(migrations.length===43){
  if(migrations[42]?.version!==43||
     migrations[42]?.file!=='043_gold_device_short_ids.sql')
   throw Error('gold_migration_043_source_unreviewed');
  if(env.LR_GOLD_ABV2_043_MIGRATOR_ACCEPT!=='1'||
     env.LR_GOLD_SCHEMA_043_RELEASE_ACCEPT!=='1')
   throw Error('gold_migration_043_independent_release_hold');
 }
 return Object.freeze({lockedThrough:migrations.length,
  candidate043Released:migrations.length===43});
}
